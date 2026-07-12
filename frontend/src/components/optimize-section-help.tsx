import type { ReactNode } from "react";

function Help({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

function HelpList({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-0.5 pl-3.5">{children}</ul>;
}

export const traceHelp = (
  <Help>
    <p>
      <strong>Each dot</strong> is one candidate&apos;s robust validation score, plotted in the
      order it was tried.
    </p>
    <HelpList>
      <li>
        <strong>Step line:</strong> best score so far
      </li>
      <li>
        <strong>Dashed line:</strong> baseline (your original strategy)
      </li>
      <li>
        <strong>Hollow dots:</strong> pruned early by successive halving
      </li>
      <li>
        <strong>Grey dots:</strong> failed an eligibility constraint
      </li>
    </HelpList>
    <p>
      <strong>What to look for:</strong>
    </p>
    <HelpList>
      <li>Step line settles clearly above the dashed line: a real improvement was found.</li>
      <li>Step line never rises above it: the baseline is already near the best of this space.</li>
      <li>Mostly grey dots: the constraints reject almost everything.</li>
    </HelpList>
    <p>Hover a dot to see what the candidate changed vs the baseline.</p>
  </Help>
);

export function decompositionHelp(objectiveLabel: string) {
  return (
    <Help>
      <p>
        <strong>Each row</strong> is one candidate: the baseline plus the top eligible trials.
      </p>
      <HelpList>
        <li>
          <strong>Full bar:</strong> median {objectiveLabel} across validation folds
        </li>
        <li>
          <strong>Colored segments:</strong> penalties subtracted from it (drawdown, fold
          instability, turnover, complexity)
        </li>
        <li>
          <strong>Tick and number:</strong> the net score that remains, which is what the
          leaderboard ranks by
        </li>
      </HelpList>
      <p>Use it to tell weak performance apart from heavy penalties.</p>
    </Help>
  );
}

export const foldsHelp = (
  <Help>
    <p>
      <strong>Each group of bars</strong> is one validation fold: a later, unseen slice of
      history.
    </p>
    <p>
      <strong>What to look for:</strong> a robust candidate beats the baseline in most folds. A
      candidate that wins only one fold likely fits a single market regime.
    </p>
  </Help>
);

export const sensitivityHelp = (
  <Help>
    <p>
      <strong>One panel per searched parameter</strong>, sorted by impact. <strong>Δ</strong> is
      how far the average score moves across the parameter&apos;s range, so the parameters that
      mattered most come first.
    </p>
    <HelpList>
      <li>
        <strong>Each dot:</strong> one trial (sampled value on x, score on y)
      </li>
      <li>
        <strong>Dashed line:</strong> the strategy&apos;s current value
      </li>
    </HelpList>
    <p>
      <strong>Look for plateaus:</strong> a broad region of good scores is robust. One isolated
      high dot is likely luck.
    </p>
  </Help>
);

export const ablationHelp = (
  <Help>
    <p>
      <strong>Each bar</strong> re-scores the best candidate with one rule disabled.
    </p>
    <HelpList>
      <li>
        <strong>Negative delta:</strong> the score drops without the rule, so it earns its place
      </li>
      <li>
        <strong>Near zero or positive:</strong> the rule adds complexity without adding value,
        making it a candidate for removal
      </li>
    </HelpList>
  </Help>
);

export const inclusionHelp = (
  <Help>
    <p>
      <strong>How often each optional rule stayed enabled</strong> among the top robust
      candidates.
    </p>
    <p>
      A rule kept by most of them is stronger evidence than one that appears in a single lucky
      trial.
    </p>
  </Help>
);

export const leaderboardHelp = (
  <Help>
    <HelpList>
      <li>
        <strong>All:</strong> every trial, including pruned ones
      </li>
      <li>
        <strong>Eligible:</strong> passed the hard constraints (minimum trades, maximum
        drawdown, enough positive folds)
      </li>
      <li>
        <strong>Ineligible:</strong> scored but failed a constraint
      </li>
      <li>
        <strong>Promoted:</strong> survived successive halving into the full evaluation stage
      </li>
    </HelpList>
    <p>Click a row to inspect the candidate&apos;s diff, folds, and equity below.</p>
  </Help>
);

export const searchSpaceHelp = (
  <Help>
    <p>
      <strong>The defaults are safe:</strong> every rule stays required and every parameter is
      tuned over a conservative range around its current value.
    </p>
    <HelpList>
      <li>
        <strong>Required:</strong> the rule is always active
      </li>
      <li>
        <strong>Optional:</strong> the search tries the strategy with and without it
      </li>
      <li>
        <strong>Off:</strong> the rule is removed before searching
      </li>
    </HelpList>
    <p>
      Expand a rule to adjust its parameters. <strong>Tune</strong> searches within the min to
      max range; <strong>Lock</strong> pins the current value.
    </p>
  </Help>
);
