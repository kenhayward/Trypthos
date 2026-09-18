import { useTranslation } from "react-i18next";
import type { IndexAge } from "../lib/graphStatus";

/// How long ago an index was built, in words.
///
/// Shared by the graph section and the home page's counts line, which both say it. It was private to
/// the graph page until a second place needed it, and a second copy would have drifted into saying
/// "5 min ago" in one and something else in the other.
export function useAgeText(): (age: IndexAge) => string {
  const { t } = useTranslation();
  return (age) => {
    if (age.unit === "minutes") return t("graph.ageMinutes", { count: age.count });
    if (age.unit === "hours") return t("graph.ageHours", { count: age.count });
    if (age.unit === "days") return t("graph.ageDays", { count: age.count });
    return t("graph.ageNow");
  };
}
