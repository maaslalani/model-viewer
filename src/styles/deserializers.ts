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

import {degreesToRadians, radiansToDegrees} from './conversions.js';
import {IdentNode, parseExpressions} from './parsers.js';


/**
 * Parses an angle CSS number string and deserializes it as a number with the
 * given unit type. For example:
 *
 * deserializeAngle('1rad', 'rad'); // Returns 1
 * deserializeAngle('1rad', 'deg'); // Returns 57.29577951308232
 * deserializeAngle('180deg', 'rad'); // Returns 3.141592653589793
 */
export const deserializeAngle =
    (angleString: string, unit: 'deg'|'rad' = 'deg'): number|null => {
      try {
        const expressionNodes = parseExpressions(angleString);

        if (expressionNodes.length === 0) {
          return null;
        }

        const [angleNode] = expressionNodes[0].terms;

        if (angleNode.type !== 'number') {
          return null;
        }

        const normalizedAngleNode = unit === 'deg' ?
            radiansToDegrees(angleNode) :
            degreesToRadians(angleNode);

        return normalizedAngleNode.number;
      } catch (_error) {
      }

      return null;
    };


/**
 * For our purposes, an enumeration is a fixed set of CSS-expression-compatible
 * names. When serialized, a selected subset of the members may be specified as
 * whitespace-separated strings. An enumeration deserializer is a function that
 * parses a serialized subset of an enumeration and returns any members that are
 * found as a Set.
 *
 * The following example will produce a deserializer for the days of the
 * week:
 *
 * const deserializeDaysOfTheWeek = enumerationDeserializer([
 *   'Monday',
 *   'Tuesday',
 *   'Wednesday',
 *   'Thursday',
 *   'Friday',
 *   'Saturday',
 *   'Sunday'
 * ]);
 */
export const enumerationDeserializer = <T extends string>(allowedNames: T[]) =>
    (valueString: string): Set<T> => {
      try {
        const expressions = parseExpressions(valueString);
        const names = (expressions.length ? expressions[0].terms : [])
                          .filter<IdentNode>(
                              (valueNode): valueNode is IdentNode =>
                                  valueNode && valueNode.type === 'ident')
                          .map(valueNode => valueNode.value as T)
                          .filter(name => allowedNames.indexOf(name) > -1);

        // NOTE(cdata): IE11 does not support constructing a Set directly from
        // an iterable, so we need to manually add all the items:
        const result = new Set<T>();
        for (const name of names) {
          result.add(name);
        }
        return result;
      } catch (_error) {
      }
      return new Set();
    };