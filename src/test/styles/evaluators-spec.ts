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

import {CalcEvaluator, EnvEvaluator, OperatorEvaluator, SphericalEvaluator} from '../../styles/evaluators.js';
import {expressionNode, functionNode, identNode, numberNode, operatorNode, spy} from '../helpers.js';

const expect = chai.expect;

suite('evaluators', () => {
  suite('EnvEvaluator', () => {
    test('is never constant', () => {
      const evaluator = new EnvEvaluator(functionNode('env', []));
      expect(evaluator.isConstant).to.be.false;
    });

    test('with no arguments, evaluates to zero', () => {
      const evaluator = new EnvEvaluator(functionNode('env', []));
      expect(evaluator.evaluate()).to.be.eql(numberNode(0, null));
    });

    suite('window-scroll-y', () => {
      test('evaluates to current top-level scroll position', () => {
        const evaluator = new EnvEvaluator(functionNode(
            'env', [expressionNode([identNode('window-scroll-y')])]));
        expect(evaluator.evaluate()).to.be.eql(numberNode(0, null));
        const scrollPosition = 10000;
        const scrollMax = 20000;

        const restorePageYOffset =
            spy(window, 'pageYOffset', {value: scrollPosition});
        const restoreBodyScrollHeight =
            spy(document.documentElement, 'clientHeight', {value: scrollMax});

        expect(evaluator.evaluate())
            .to.be.eql(numberNode(
                scrollPosition / (scrollMax - window.innerHeight), null));

        restorePageYOffset();
        restoreBodyScrollHeight();
      });
    });
  });

  suite('CalcEvaluator', () => {
    test('is constant if its operands are all numbers', () => {
      const evaluator = new CalcEvaluator(functionNode(
          'calc',
          [expressionNode(
              [numberNode(1, null), operatorNode('+'), numberNode(1, null)])]));

      expect(evaluator.isConstant).to.be.true;
    });

    test('is constant if nested functions are constant', () => {
      const evaluator = new CalcEvaluator(functionNode(
          'calc', [expressionNode([
            numberNode(1, null),
            operatorNode('+'),
            functionNode('calc', [expressionNode([numberNode(1, null)])])
          ])]));

      expect(evaluator.isConstant).to.be.true;
    });

    test('is not constant if any nested function is not constant', () => {
      const evaluator = new CalcEvaluator(functionNode('calc', [
        expressionNode([
          numberNode(1, null),
          operatorNode('+'),
          functionNode('calc', [expressionNode([numberNode(1, null)])]),
          operatorNode('+'),
          functionNode('env', [expressionNode([identNode('window-scroll-y')])])
        ])
      ]));

      expect(evaluator.isConstant).to.be.false;
    });

    test('with no arguments, evaluates to zero', () => {
      const evaluator = new CalcEvaluator(functionNode('env', []));
      expect(evaluator.evaluate()).to.be.eql(numberNode(0, null));
    });

    test('evaluates basic addition', () => {
      const evaluator = new CalcEvaluator(functionNode(
          'calc',
          [expressionNode(
              [numberNode(1, null), operatorNode('+'), numberNode(1, null)])]));

      expect(evaluator.evaluate()).to.be.eql(numberNode(2, null));
    });

    test('evaluates basic subtraction', () => {
      const evaluator = new CalcEvaluator(functionNode(
          'calc',
          [expressionNode(
              [numberNode(1, null), operatorNode('-'), numberNode(1, null)])]));

      expect(evaluator.evaluate()).to.be.eql(numberNode(0, null));
    });

    test('evaluates basic multiplication', () => {
      const evaluator = new CalcEvaluator(functionNode(
          'calc',
          [expressionNode(
              [numberNode(5, null), operatorNode('*'), numberNode(4, null)])]));

      expect(evaluator.evaluate()).to.be.eql(numberNode(20, null));
    });

    test('evaluates basic division', () => {
      const evaluator = new CalcEvaluator(functionNode('calc', [
        expressionNode(
            [numberNode(100, null), operatorNode('/'), numberNode(10, null)])
      ]));

      expect(evaluator.evaluate()).to.be.eql(numberNode(10, null));
    });

    test('evaluates complex algebraic expressions', () => {
      const evaluator = new CalcEvaluator(functionNode('calc', [
        expressionNode([
          numberNode(1, null),
          operatorNode('+'),
          numberNode(2, null),
          operatorNode('*'),
          numberNode(2.5, null),
          operatorNode('-'),
          numberNode(-2, null),
          operatorNode('/'),
          numberNode(-1, null)
        ]),
      ]));

      expect(evaluator.evaluate()).to.be.eql(numberNode(4, null));
    });

    test('evaluates algebra with nested functions', () => {
      test('evaluates basic addition', () => {
        const evaluator = new CalcEvaluator(functionNode(
            'calc', [expressionNode([
              numberNode(1, null),
              operatorNode('+'),
              functionNode('calc', [expressionNode([numberNode(1, null)])])
            ])]));

        expect(evaluator.evaluate()).to.be.eql(numberNode(2, null));
      });
    });
  });

  suite('OperatorEvaluator', () => {
    test('evaluates zero for an unknown operator', () => {
      const evaluator = new OperatorEvaluator(
          operatorNode('$' as any), numberNode(1, null), numberNode(1, null));

      expect(evaluator.evaluate()).to.be.eql(numberNode(0, null));
    });

    test('evaluates zero for operands with mismatching unit types', () => {
      const evaluator = new OperatorEvaluator(
          operatorNode('+'), numberNode(1, 'm'), numberNode(1, 'rad'));

      expect(evaluator.evaluate()).to.be.eql(numberNode(0, null));
    });

    test('normalizes to base meters for length operands', () => {
      const evaluator = new OperatorEvaluator(
          operatorNode('+'), numberNode(1, 'm'), numberNode(1000, 'mm'));

      expect(evaluator.evaluate()).to.be.eql(numberNode(2, 'm'));
    });

    test('normalizes to radians for angular operands', () => {
      const evaluator = new OperatorEvaluator(
          operatorNode('+'),
          numberNode(180, 'deg'),
          numberNode(Math.PI, 'rad'));

      expect(evaluator.evaluate()).to.be.eql(numberNode(2 * Math.PI, 'rad'));
    });
  });

  suite('SphericalEvaluator', () => {
    test('evalauates to defaults for omitted expressions', () => {
      const evaluator = new SphericalEvaluator([]);

      expect(evaluator.evaluate()).to.be.eql([0, 0, 'auto']);
    });

    test('evaluates spherical values from basic expressions', () => {
      const evaluator = new SphericalEvaluator([expressionNode([
        numberNode(1, 'rad'),
        numberNode(180, 'deg'),
        numberNode(100, 'cm')
      ])]);

      expect(evaluator.evaluate()).to.be.eql([1, Math.PI, 1]);
    });

    test('evaluates spherical values from complex expressions', () => {
      const evaluator = new SphericalEvaluator([expressionNode([
        numberNode(1, 'rad'),
        numberNode(180, 'deg'),
        functionNode('calc', [
          expressionNode([
            numberNode(1, 'm'),
            operatorNode('+'),
            functionNode('calc', [expressionNode([numberNode(1, null)])]),
            operatorNode('+'),
            functionNode('env', [expressionNode([identNode('window-scroll-y')])])
          ])
        ])
      ])]);

      expect(evaluator.evaluate()).to.be.eql([1, Math.PI, 2]);
    });
  });
});