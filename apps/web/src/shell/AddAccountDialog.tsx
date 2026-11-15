import { CloseIcon } from "./icons";

/** Placeholder: an empty titled modal. The accounts Build fills it in. */
export function AddAccountDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop top">
      <div className="dialog modal" role="dialog" aria-label="Add Accounts">
        <div className="dialog-head">
          <h2>Add Accounts</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
