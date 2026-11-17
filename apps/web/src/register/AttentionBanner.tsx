import { attentionBannerText } from "@budget/schema/attention";
import { useAttentionFilter } from "./attention-filter";
import { InfoCircleIcon } from "./icons";

/** "N new transactions to approve or categorize." with View, above the account header; nothing at 0. */
export function AttentionBanner({ count }: { count: number | undefined }) {
  const { setOn } = useAttentionFilter();
  if (!count) return null;
  const text = attentionBannerText(count);
  return (
    <section className="attention-banner" aria-label="New transactions">
      <InfoCircleIcon />
      <p title={text}>{text}</p>
      <button type="button" className="attention-banner-view" onClick={() => setOn(true)}>
        View
      </button>
    </section>
  );
}
