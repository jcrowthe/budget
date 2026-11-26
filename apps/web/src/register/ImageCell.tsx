import { IMAGE_ACCEPT } from "@budget/schema/transaction-images";
import { useRef, useState } from "react";
import { transactionImageUrl, useUploadTransactionImage } from "../api/transaction-images";
import { ImageViewer } from "./ImageViewer";
import { PhotoIcon } from "./icons";
import "./register-image.css";

/** One row's image cell: the grey photo icon (upload), or the thumbnail that opens the viewer. */
export function ImageCell({
  budgetId,
  id,
  hasImage,
}: {
  budgetId: string;
  id: string;
  hasImage: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const thumb = useRef<HTMLButtonElement>(null);
  const [viewing, setViewing] = useState(false);
  const upload = useUploadTransactionImage(budgetId);
  const error = upload.error?.message;

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (file) upload.mutate({ id, file });
  };

  return (
    <>
      {hasImage ? (
        <button
          ref={thumb}
          type="button"
          className="image-thumb-button"
          title="Transaction Photo"
          aria-label="Transaction Photo"
          onClick={(e) => {
            e.stopPropagation();
            setViewing(true);
          }}
        >
          <img src={transactionImageUrl(budgetId, id)} alt="" className="image-thumb" />
        </button>
      ) : (
        <>
          <button
            type="button"
            className="image-add-button"
            title={error ?? "Add Image"}
            aria-label="Add Image"
            disabled={upload.isPending}
            onClick={(e) => {
              e.stopPropagation();
              input.current?.click();
            }}
          >
            <PhotoIcon />
          </button>
          <input
            ref={input}
            type="file"
            className="image-file-input"
            hidden
            accept={IMAGE_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {error ? (
            <span role="alert" className="image-error">
              {error}
            </span>
          ) : null}
        </>
      )}
      {viewing && (
        <ImageViewer
          budgetId={budgetId}
          id={id}
          onClose={() => {
            setViewing(false);
            thumb.current?.focus();
          }}
        />
      )}
    </>
  );
}
