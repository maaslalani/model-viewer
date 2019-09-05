/*
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {normalizeUnit} from './conversions';
import {ExpressionNode, ExpressionTerm, FunctionNode, IdentNode, NumberNode, OperatorNode} from './parsers';

export type Evaluatable<T> = Evaluator<T>|T;

// Common fallback node values used for parse error scenarios:
const ZERO: NumberNode = Object.freeze({type: 'number', number: 0, unit: null});
const AUTO: IdentNode = Object.freeze({type: 'ident', value: 'auto'});


const $evaluate = Symbol('evaluate');
const $lastValue = Symbol('lastValue');

/**
 * An Evaluator is used to derive a computed style from part (or all) of a CSS
 * expression AST. This construct is particularly useful for complex ASTs
 * containing function calls such as calc, var and env. Such styles could be
 * costly to re-evaluate on every frame (and in some cases we may try to do
 * that). The Evaluator construct allows us to mark sub-trees of the AST as
 * constant, so that only the dynamic parts are re-evaluated. It also separates
 * one-time AST preparation work from work that necessarily has to happen upon
 * each evaluation.
 */
export abstract class Evaluator<T> {
  /**
   * An Evaluatable is a NumberNode or an Evaluator that evaluates a NumberNode
   * as the result of invoking its evaluate method. This is mainly used to
   * ensure that CSS function nodes are cast to the corresponding Evaluators
   * that will resolve the result of the function.
   */
  static evaluatableFor(node: ExpressionTerm|
                        Evaluator<NumberNode>): Evaluatable<NumberNode> {
    if (node instanceof Evaluator || node.type === 'number') {
      return node;
    }

    switch ((node as FunctionNode).name.value) {
      case 'calc':
        return new CalcEvaluator(node as FunctionNode);
      case 'env':
        return new EnvEvaluator(node as FunctionNode);
    }

    return ZERO;
  }

  /**
   * If the input is an Evaluator, returns the result of evaluating it.
   * Otherwise, returns the input.
   *
   * This is a helper to aide in resolving a NumberNode without conditionally
   * checking if the Evaluatable is an Evaluator everywhere.
   */
  static evaluate<T extends NumberNode|IdentNode>(evaluatable: Evaluatable<T>):
      T {
    if (evaluatable instanceof Evaluator) {
      return evaluatable.evaluate();
    }

    return evaluatable;
  }

  /**
   * If the input is an Evaluator, returns the value of its isConstant property.
   * Returns true for all other input values.
   */
  static isConstant<T>(evaluatable: Evaluatable<T>): boolean {
    if (evaluatable instanceof Evaluator) {
      return evaluatable.isConstant;
    }
    return true;
  }

  /**
   * If true, the Evaluator will only evaluate its AST one time. If false, the
   * Evaluator will re-evaluate the AST each time that the public evaluate
   * method is invoked.
   */
  get isConstant(): boolean {
    return false;
  };

  protected[$lastValue]: T|null = null;

  /**
   * This method must be implemented by subclasses. Its implementation should be
   * the actual steps to evaluate the AST, and should return the evaluated
   * result.
   */
  protected abstract[$evaluate](): T;

  /**
   * Evaluate the Evaluator and return the result. If the Evaluator is constant,
   * the corresponding AST will only be evaluated once, and the result of
   * evaluating it the first time will be returned on all subsequent
   * evaluations.
   */
  evaluate(): T {
    if (!this.isConstant || this[$lastValue] == null) {
      this[$lastValue] = this[$evaluate]();
    }
    return this[$lastValue]!;
  }
}


const $identNode = Symbol('identNode');

/**
 * Evaluator for CSS-like env() functions. Currently, only one environment
 * variable is accepted as an argument for such functions: window-scroll-y.
 *
 * The env() Evaluator is explicitly dynamic because it always refers to
 * external state that changes as the user scrolls, so it should always be
 * re-evaluated to ensure we get the most recent value.
 *
 * Some important notes about this feature include:
 *
 *  - There is no such thing as a "window-scroll-y" CSS environment variable in
 *    any stable browser at the time that this comment is being written.
 *  - The actual CSS env() function accepts a second argument as a fallback for
 *    the case that the specified first argument isn't set; our syntax does not
 *    support this second argument.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/env
 */
export class EnvEvaluator extends Evaluator<NumberNode> {
  protected[$identNode]: IdentNode|null = null;

  constructor(envFunction: FunctionNode) {
    super();

    const identNode =
        envFunction.arguments.length ? envFunction.arguments[0].terms[0] : null;

    if (identNode != null && identNode.type === 'ident') {
      this[$identNode] = identNode;
    }
  }

  get isConstant(): boolean {
    return false;
  };

  [$evaluate](): NumberNode {
    if (this[$identNode] != null) {
      switch (this[$identNode]!.value) {
        case 'window-scroll-y':
          const verticalScrollPosition = window.pageYOffset;
          const verticalScrollMax = Math.max(
              document.body.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.clientHeight,
              document.documentElement.scrollHeight,
              document.documentElement.offsetHeight);
          const scrollY = verticalScrollPosition /
                  (verticalScrollMax - window.innerHeight) ||
              0;

          return {type: 'number', number: scrollY, unit: null};
      }
    }

    return ZERO;
  }
}


const IS_MULTIPLICATION_RE = /[\*\/]/;
const $evaluator = Symbol('evalutor');

/**
 * Evaluator for CSS-like calc() functions. Our implementation of calc()
 * evaluation currently support nested function calls, an unlimited number of
 * terms, and all four algebraic operators (+, -, * and /).
 *
 * The Evaluator is marked as constant unless the calc expression contains an
 * internal env expression at any depth, in which case it will be marked as
 * dynamic.
 *
 * @see https://www.w3.org/TR/css-values-3/#calc-syntax
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/calc
 */
export class CalcEvaluator extends Evaluator<NumberNode> {
  protected[$evaluator]: Evaluator<NumberNode>|null = null;

  constructor(calcFunction: FunctionNode) {
    super();

    if (calcFunction.arguments.length !== 1) {
      return;
    }

    const terms: Array<ExpressionTerm> =
        calcFunction.arguments[0].terms.slice();
    const secondOrderTerms: Array<ExpressionTerm|Evaluator<NumberNode>> = [];

    while (terms.length) {
      const term: ExpressionTerm = terms.shift()!;

      if (secondOrderTerms.length > 0) {
        const previousTerm =
            secondOrderTerms[secondOrderTerms.length - 1] as ExpressionTerm;
        if (previousTerm.type === 'operator' &&
            IS_MULTIPLICATION_RE.test(previousTerm.value)) {
          const operator = secondOrderTerms.pop() as OperatorNode;
          const leftValue = secondOrderTerms.pop();

          if (leftValue == null) {
            return;
          }

          secondOrderTerms.push(new OperatorEvaluator(
              operator,
              Evaluator.evaluatableFor(leftValue),
              Evaluator.evaluatableFor(term)));
          continue;
        }
      }

      secondOrderTerms.push(
          term.type === 'operator' ? term : Evaluator.evaluatableFor(term));
    }

    while (secondOrderTerms.length > 2) {
      const [left, operator, right] = secondOrderTerms.splice(0, 3);
      if ((operator as ExpressionTerm).type !== 'operator') {
        return;
      }

      secondOrderTerms.unshift(new OperatorEvaluator(
          operator as OperatorNode,
          Evaluator.evaluatableFor(left),
          Evaluator.evaluatableFor(right)));
    }

    // There should only be one combined evaluator at this point:
    if (secondOrderTerms.length === 1) {
      this[$evaluator] = secondOrderTerms[0] as Evaluator<NumberNode>;
    }
  }

  get isConstant() {
    return this[$evaluator] == null || Evaluator.isConstant(this[$evaluator]!);
  }

  [$evaluate]() {
    return this[$evaluator] != null ? Evaluator.evaluate(this[$evaluator]!) :
                                      ZERO;
  }
}



const $operator = Symbol('operator');
const $left = Symbol('left');
const $right = Symbol('right');

/**
 * An Evaluator for the operators found inside CSS calc() functions.
 * The evaluator accepts an operator and left/right operands. The operands can
 * be any valid expression term typically allowed inside a CSS calc function.
 *
 * As detail of this implementation, the only supported unit types are angles
 * expressed as radians or degrees, and lengths expressed as meters, centimeters
 * or millimeters.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/calc
 */
export class OperatorEvaluator extends Evaluator<NumberNode> {
  protected[$operator]: OperatorNode;
  protected[$left]: Evaluatable<NumberNode>;
  protected[$right]: Evaluatable<NumberNode>;

  constructor(
      operator: OperatorNode, left: Evaluatable<NumberNode>,
      right: Evaluatable<NumberNode>) {
    super();
    this[$operator] = operator;
    this[$left] = left;
    this[$right] = right;
  }

  get isConstant() {
    return Evaluator.isConstant(this[$left]) &&
        Evaluator.isConstant(this[$right]);
  }

  [$evaluate](): NumberNode {
    const leftNode = normalizeUnit(Evaluator.evaluate(this[$left]));
    const rightNode = normalizeUnit(Evaluator.evaluate(this[$right]));
    const {number: leftValue, unit: leftUnit} = leftNode;
    const {number: rightValue, unit: rightUnit} = rightNode;

    // Disallow operations for mismatched normalized units e.g., m and rad:
    if (rightUnit != null && leftUnit != null && rightUnit != leftUnit) {
      return ZERO;
    }

    // NOTE(cdata): rules for calc type checking are defined here
    // https://drafts.csswg.org/css-values-3/#calc-type-checking
    // This is a simplification and may not hold up once we begin to support
    // additional unit types:
    const unit = leftUnit || rightUnit;
    let value;

    switch (this[$operator].value) {
      case '+':
        value = leftValue + rightValue;
        break;
      case '-':
        value = leftValue - rightValue;
        break;
      case '/':
        value = leftValue / rightValue;
        break;
      case '*':
        value = leftValue * rightValue;
        break;
      default:
        return ZERO;
    }

    return {type: 'number', number: value, unit};
  }
}


export type SphericalStyle = [number, number, number | string];

const $theta = Symbol('theta');
const $phi = Symbol('phi');
const $radius = Symbol('radius');

/**
 * An Evaluator for the "spherical" CSS expression format such as the one used
 * by <model-viewer>. This format expresses a spherical position with three
 * values:
 *
 *  - An azimuth angle in degrees or radians
 *  - An inclination angle in degrees or radians
 *  - A radius, expressed as meters or the keyword "auto"
 *
 * This Evaluator is configured with an array of expression ASTs and evaluates
 * an array containing three values: two numbers for azimuth and inclination in
 * radians, and a number in meters or 'auto' representing the radius.
 *
 * Examples of "spherical" expressions include:
 *
 *  - 0 10deg auto
 *  - 1.5rad -30deg 1m
 */
export class SphericalEvaluator extends Evaluator<SphericalStyle> {
  protected[$lastValue]: SphericalStyle|null = null;

  protected[$theta]: Evaluatable<NumberNode>;
  protected[$phi]: Evaluatable<NumberNode>;
  protected[$radius]: Evaluatable<IdentNode|NumberNode>;

  constructor(expressions: Array<ExpressionNode>) {
    super();

    const expression = expressions[0];
    let [thetaTerm, phiTerm, radiusTerm] =
        expression != null ? expression.terms : [] as Array<ExpressionTerm>;

    if (thetaTerm == null) {
      thetaTerm = ZERO;
    }

    if (phiTerm == null) {
      phiTerm = ZERO;
    }

    if (radiusTerm == null) {
      radiusTerm = AUTO;
    }

    this[$theta] = Evaluator.evaluatableFor(thetaTerm);
    this[$phi] = Evaluator.evaluatableFor(phiTerm);
    this[$radius] = radiusTerm.type === 'ident' ?
        radiusTerm :
        Evaluator.evaluatableFor(radiusTerm as NumberNode);
  }

  get isConstant(): boolean {
    return Evaluator.isConstant(this[$theta]) &&
        Evaluator.isConstant(this[$phi]) && Evaluator.isConstant(this[$radius]);
  }

  [$evaluate](): SphericalStyle {
    const radiusNode = Evaluator.evaluate(this[$radius]);

    return [
      normalizeUnit(Evaluator.evaluate(this[$theta])).number,
      normalizeUnit(Evaluator.evaluate(this[$phi])).number,
      radiusNode.type === 'ident' ?
          radiusNode.value :
          normalizeUnit(Evaluator.evaluate(radiusNode)).number
    ];
  }
}
