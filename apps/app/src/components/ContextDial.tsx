import { useTranslation } from "react-i18next";
import type { ContextUsage } from "@trypthos/domain";

interface Props {
  usage: ContextUsage;
}

const SIZE = 16;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/// How full the model's context is, as a ring you can hover.
///
/// A ring rather than a number on the bar: the number is only interesting near the end, and a
/// running token count beside the composer is one more thing to read on every keystroke. The amount
/// and the total live in the hover, which is where somebody who wants them will look.
///
/// **Everything here is an estimate and the wording says so.** See `contextUsage` in the domain for
/// why it cannot be otherwise: there is no tokeniser to ask, and the endpoint reports its own count
/// only in the reply - after the question this exists to inform.
export default function ContextDial({ usage }: Props) {
  const { t, i18n } = useTranslation();

  // Grouped by the catalogue's language rather than the machine's: a test that follows the machine's
  // locale is a test that fails on somebody else's machine, and this is English-only anyway.
  const number = new Intl.NumberFormat(i18n.language || "en");
  const tokens = number.format(usage.tokens);

  const description =
    usage.limit === null
      ? t("chat.context.unknown", { tokens })
      : usage.over
        ? t("chat.context.over", { tokens, limit: number.format(usage.limit) })
        : t("chat.context.used", { tokens, limit: number.format(usage.limit) });

  // Null reads as a ring with no fill: the track alone, which is what "we do not know how full this
  // is" looks like. Drawing a guess would be a confident lie.
  const filled = usage.fraction ?? 0;

  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className="ml-auto flex shrink-0 items-center"
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-4" aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-rule"
        />
        {filled > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * filled} ${CIRCUMFERENCE}`}
            // From twelve o'clock, like every other dial, rather than from three.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            className={usage.over ? "text-danger" : "text-accent"}
          />
        )}
      </svg>
    </span>
  );
}
