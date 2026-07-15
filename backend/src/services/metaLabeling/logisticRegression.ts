export interface Standardizer {
  means: number[];
  stds: number[];
}

export interface LogisticModel {
  weights: number[];
  bias: number;
}

export interface LogisticOptions {
  learningRate?: number;
  iterations?: number;
  l2?: number;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const exp = Math.exp(z);
  return exp / (1 + exp);
}

function dot(weights: number[], row: number[]): number {
  let sum = 0;
  for (let col = 0; col < weights.length; col += 1) {
    sum += weights[col] * row[col];
  }
  return sum;
}

export function fitStandardizer(rows: Array<Array<number | null>>): Standardizer {
  const featureCount = rows[0]?.length ?? 0;
  const means: number[] = [];
  const stds: number[] = [];
  for (let col = 0; col < featureCount; col += 1) {
    const values = rows
      .map((row) => row[col])
      .filter((value): value is number => value != null);
    const mean = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const variance = values.length
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      : 0;
    const std = Math.sqrt(variance);
    means.push(mean);
    stds.push(std > 1e-12 ? std : 1);
  }
  return { means, stds };
}

export function standardizeRow(
  row: Array<number | null>,
  standardizer: Standardizer,
): number[] {
  return row.map((value, col) =>
    value == null ? 0 : (value - standardizer.means[col]) / standardizer.stds[col],
  );
}

export function fitLogistic(
  matrix: number[][],
  labels: number[],
  options: LogisticOptions = {},
): LogisticModel {
  const learningRate = options.learningRate ?? 0.1;
  const iterations = options.iterations ?? 500;
  const l2 = options.l2 ?? 0.01;
  const featureCount = matrix[0]?.length ?? 0;
  const weights = new Array<number>(featureCount).fill(0);
  let bias = 0;
  const rowCount = matrix.length;
  if (rowCount === 0) {
    return { weights, bias };
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array<number>(featureCount).fill(0);
    let biasGradient = 0;
    for (let row = 0; row < rowCount; row += 1) {
      const error = sigmoid(dot(weights, matrix[row]) + bias) - labels[row];
      for (let col = 0; col < featureCount; col += 1) {
        gradient[col] += error * matrix[row][col];
      }
      biasGradient += error;
    }
    for (let col = 0; col < featureCount; col += 1) {
      weights[col] -= learningRate * (gradient[col] / rowCount + l2 * weights[col]);
    }
    bias -= learningRate * (biasGradient / rowCount);
  }
  return { weights, bias };
}

export function logisticMargin(model: LogisticModel, row: number[]): number {
  return dot(model.weights, row) + model.bias;
}

export function predictProbability(model: LogisticModel, row: number[]): number {
  return sigmoid(logisticMargin(model, row));
}
