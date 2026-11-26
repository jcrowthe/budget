import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  downloadTransactionImage,
  transactionImageUrl,
  useDeleteTransactionImage,
} from "../api/transaction-images";
import { DeleteDialog } from "./BulkDialogs";
import { CloseSmallIcon, DownloadIcon, TrashIcon } from "./icons";
import "./register-image.css";

/** The full-screen view of a transaction's image: dimmed, the image centred, Delete / Download / Close below. */
export function ImageViewer({
  budgetId,
  id,
  onClose,
}: {
  budgetId: string;
  id: string;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const remove = useDeleteTransactionImage(budgetId);

  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // With the confirm open, Escape closes only the confirm (its own handler).
      if (e.key !== "Escape" || confirming) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirming, onClose]);

  const download = async () => {
    try {
      setFailed(null);
      await downloadTransactionImage(budgetId, id);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Download failed");
    }
  };

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Transaction Photo">
      <div className="image-viewer-stage">
        <img className="image-viewer-img" src={transactionImageUrl(budgetId, id)} alt="" />
      </div>
      {failed ? (
        <p role="alert" className="image-viewer-error">
          {failed}
        </p>
      ) : null}
      <div className="image-viewer-bar">
        <button
          type="button"
          className="image-viewer-action is-destructive"
          onClick={() => setConfirming(true)}
        >
          <TrashIcon width={16} height={16} />
          Delete Image
        </button>
        <button type="button" className="image-viewer-action" onClick={download}>
          <DownloadIcon width={16} height={16} />
          Download Image
        </button>
        <button ref={close} type="button" className="image-viewer-action" onClick={onClose}>
          <CloseSmallIcon width={12} height={12} />
          Close
        </button>
      </div>
      {confirming && (
        <DeleteDialog
          title="Delete Image"
          paragraphs={["Are you sure you want to delete this image?"]}
          onCancel={() => setConfirming(false)}
          onDelete={() =>
            remove.mutate(id, {
              onSuccess: () => {
                setConfirming(false);
                onClose();
              },
              onError: (e) => {
                setConfirming(false);
                setFailed(e.message);
              },
            })
          }
        />
      )}
    </div>,
    document.body,
  );
}
