import { applyValues, sampleNumeric, snapToStep } from "./sampler.ts";
import { collectRules, getAtPath, pathId, setAtPath } from "./strategyPaths.ts";
import { pruneDisabledConditions } from "../signals.ts";
import { comparisonOperators } from "../strategyValidationHelpers.ts";
import type { SeededRandom } from "./random.ts";
import type {
  ComparisonOperator,
  EvolutionSearchConfig,
  IndicatorOperand,
  SearchSpaceNode,
  Strategy,
  StrategyCondition,
  StrategyGroup,
  TrialValues,
} from "../../types.ts";

export interface AddedRule {
  insertionPoint: string;
  libraryIndex: number;
}

export interface EvolutionGenome {
  values: TrialValues;
  operators: Record<string, ComparisonOperator>;
  atLeast: Record<string, number>;
  added: AddedRule[];
}

export function identityGenome(nodes: SearchSpaceNode[]): EvolutionGenome {
  const values: TrialValues = {};
  for (const node of nodes) {
    values[node.id] = node.current;
  }
  return { values, operators: {}, atLeast: {}, added: [] };
}

export function materializeGenome(
  baseStrategy: Strategy,
  nodes: SearchSpaceNode[],
  genome: EvolutionGenome,
  config: EvolutionSearchConfig,
): Strategy {
  const strategy = applyValues(baseStrategy, nodes, genome.values);
  for (const [ruleId, operator] of Object.entries(genome.operators)) {
    setAtPath(strategy, [...ruleId.split("."), "operator"], operator);
  }
  for (const [groupId, count] of Object.entries(genome.atLeast)) {
    setAtPath(strategy, [...groupId.split("."), "count"], count);
  }
  for (const added of genome.added) {
    const group = getAtPath(strategy, added.insertionPoint.split(".")) as StrategyGroup;
    group.conditions.push(structuredClone(config.ruleLibrary[added.libraryIndex]));
  }
  return strategy;
}

export function collectAtLeastGroups(strategy: Strategy): string[] {
  const groups: string[] = [];
  const visit = (condition: StrategyCondition, path: string[]) => {
    if (condition.type === "rule") {
      return;
    }
    if (condition.operator === "at_least") {
      groups.push(pathId(path));
    }
    condition.conditions.forEach((child, index) =>
      visit(child, [...path, "conditions", String(index)]),
    );
  };
  for (const side of ["entry", "exit", "cash"] as const) {
    if (strategy[side]) {
      visit(strategy[side]!, [side]);
    }
  }
  return groups;
}

export interface MutationContext {
  nodes: SearchSpaceNode[];
  baseStrategy: Strategy;
  config: EvolutionSearchConfig;
  random: SeededRandom;
}

export function mutateGenome(genome: EvolutionGenome, context: MutationContext): EvolutionGenome {
  const { nodes, baseStrategy, config, random } = context;
  const mutated = structuredClone(genome);
  const mutations: Array<() => void> = [];

  if (nodes.length > 0) {
    mutations.push(() => {
      const node = random.pick(nodes);
      if (node.kind === "numeric") {
        const current = (mutated.values[node.id] as number) ?? node.current;
        const nudge = node.step * random.nextInt(1, 3) * (random.nextBoolean() ? 1 : -1);
        const nudged = snapToStep(node, current + nudge);
        mutated.values[node.id] = nudged === current ? sampleNumeric(node, random) : nudged;
      } else if (node.kind === "categorical") {
        mutated.values[node.id] = random.pick(node.choices);
      } else {
        mutated.values[node.id] = !(mutated.values[node.id] ?? node.current);
      }
    });
  }

  const rules = collectRules(baseStrategy);
  if (rules.length > 0) {
    mutations.push(() => {
      const { path, rule } = random.pick(rules);
      const ruleId = pathId(path);
      const currentOperator = mutated.operators[ruleId] ?? rule.operator;
      mutated.operators[ruleId] = random.pick(
        comparisonOperators.filter((operator) => operator !== currentOperator),
      );
    });
  }

  const atLeastGroups = collectAtLeastGroups(baseStrategy);
  if (atLeastGroups.length > 0) {
    mutations.push(() => {
      const groupId = random.pick(atLeastGroups);
      const group = getAtPath(baseStrategy, groupId.split(".")) as StrategyGroup;
      const size =
        group.conditions.length +
        mutated.added.filter((added) => added.insertionPoint === groupId).length;
      const current = mutated.atLeast[groupId] ?? group.count ?? group.conditions.length;
      const proposed = current + (random.nextBoolean() ? 1 : -1);
      mutated.atLeast[groupId] = Math.min(Math.max(1, proposed), size);
    });
  }

  if (config.ruleLibrary.length > 0 && config.insertionPoints.length > 0) {
    mutations.push(() => {
      const insertionPoint = random.pick(config.insertionPoints);
      const side = insertionPoint.split(".")[0];
      const addedOnSide = mutated.added.filter(
        (added) => added.insertionPoint.split(".")[0] === side,
      );
      if (addedOnSide.length >= config.maxNewRulesPerSide) {
        return;
      }
      mutated.added.push({
        insertionPoint,
        libraryIndex: random.nextInt(0, config.ruleLibrary.length - 1),
      });
    });
  }

  if (mutated.added.length > 0) {
    mutations.push(() => {
      mutated.added.splice(random.nextInt(0, mutated.added.length - 1), 1);
    });
  }

  const count = random.nextInt(1, 2);
  for (let i = 0; i < count; i += 1) {
    random.pick(mutations)();
  }
  return mutated;
}

function countRules(condition: StrategyCondition): number {
  if (condition.type === "rule") {
    return 1;
  }
  return condition.conditions.reduce((sum, child) => sum + countRules(child), 0);
}

function uniqueIndicatorCount(condition: StrategyCondition): number {
  const keys = new Set<string>();
  const visitOperand = (operand: IndicatorOperand) => {
    const parameters = Object.entries(operand.parameters)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    keys.add(`${operand.kind}(${parameters})`);
  };
  const visit = (node: StrategyCondition) => {
    if (node.type === "rule") {
      for (const operand of [node.left, node.right]) {
        if (operand.type === "indicator") {
          visitOperand(operand);
        }
      }
      return;
    }
    node.conditions.forEach(visit);
  };
  visit(condition);
  return keys.size;
}

export function validateCaps(strategy: Strategy, config: EvolutionSearchConfig): string | null {
  for (const side of ["entry", "exit", "cash"] as const) {
    const condition = strategy[side];
    const pruned = condition ? pruneDisabledConditions(condition) : null;
    if (!pruned) {
      continue;
    }
    const activeRules = countRules(pruned);
    if (activeRules > config.maxActiveRulesPerSide) {
      return `${side}: ${activeRules} active rules exceeds the cap of ${config.maxActiveRulesPerSide}`;
    }
    const indicators = uniqueIndicatorCount(pruned);
    if (indicators > config.maxUniqueIndicatorsPerSide) {
      return `${side}: ${indicators} unique indicators exceeds the cap of ${config.maxUniqueIndicatorsPerSide}`;
    }
  }
  return null;
}
