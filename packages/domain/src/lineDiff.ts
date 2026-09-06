/// Comparing two files line by line.
///
/// Pure, and here rather than in the shell, because a diff is a rule over two lists of strings -
/// nothing about it needs a filesystem, and everything about it is worth testing without one.
///
/// The output is unified-diff shaped (`-` removed, `+` added, a space for context) because that is
/// the notation every model has read a million of. Inventing a prettier one would be asking a model
/// to learn something to no purpose.

export interface DiffOptions {
  /// How many lines of difference to produce before stopping. Truncation is always MARKED - a model
  /// told it has the whole comparison when it has the first four hundred lines will answer
  /// confidently and wrongly.
  limit: number;
  /// How many unchanged lines to keep either side of a change, so a difference can be placed.
  context?: number;
}

export interface DiffResult {
  /// The unified-diff shaped text, or an empty string when the files match.
  text: string;
  /// True when the two files are the same line for line.
  identical: boolean;
  truncated: boolean;
}

/// The length of the longest common subsequence, as a table.
///
/// The plain dynamic-programming diff: O(n*m) in time and memory. Fine for files of the size this
/// app opens at all - the read boundary refuses anything over sixteen megabytes, and `diffFiles`
/// refuses far smaller than that before reaching here.
function commonTable(left: readonly string[], right: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        left[i] === right[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/// One line of the comparison: what happened to it, and what it said.
interface Step {
  readonly mark: " " | "-" | "+";
  readonly text: string;
}

function walk(left: readonly string[], right: readonly string[]): Step[] {
  const table = commonTable(left, right);
  const steps: Step[] = [];

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      steps.push({ mark: " ", text: left[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      steps.push({ mark: "-", text: left[i]! });
      i += 1;
    } else {
      steps.push({ mark: "+", text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) steps.push({ mark: "-", text: left[i++]! });
  while (j < right.length) steps.push({ mark: "+", text: right[j++]! });

  return steps;
}

/// Splits a file into lines the way a comparison should read them.
///
/// Both line endings, and a trailing newline does NOT make a final empty line: a file ending in a
/// newline is the normal case, and reporting a phantom last line as a difference would make every
/// comparison between a file with one and a file without it look like a change nobody made.
function linesOf(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/// Keeps the runs that contain a change, with a little unchanged text either side, and drops the
/// rest. A comparison of two files that differ in one line should be one line long, not the file.
function trimToChanges(steps: readonly Step[], context: number): Step[] {
  const wanted = new Set<number>();
  steps.forEach((step, index) => {
    if (step.mark === " ") return;
    for (let n = index - context; n <= index + context; n += 1) {
      if (n >= 0 && n < steps.length) wanted.add(n);
    }
  });

  return steps.filter((_, index) => wanted.has(index));
}

export function diffLines(
  leftContent: string,
  rightContent: string,
  { limit, context = 2 }: DiffOptions,
): DiffResult {
  const left = linesOf(leftContent);
  const right = linesOf(rightContent);
  const steps = walk(left, right);

  if (steps.every((step) => step.mark === " ")) {
    return { text: "", identical: true, truncated: false };
  }

  const kept = trimToChanges(steps, context);
  const shown = kept.slice(0, limit);

  return {
    text: shown.map((step) => `${step.mark}${step.text}`).join("\n"),
    identical: false,
    truncated: shown.length < kept.length,
  };
}
