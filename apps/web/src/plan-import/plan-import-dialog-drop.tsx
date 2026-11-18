import { useId, useRef } from "react";

/** The drop zone: a button that opens the file picker (mouse and keyboard), and takes dropped files. */
export function PlanImportDrop({
  onFiles,
  error,
  buttonRef,
}: {
  onFiles: (files: File[]) => void;
  error: string | null;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const sentence = useId();
  return (
    <>
      <p id={sentence} className="plan-import-dialog-lead">
        Choose the zip made by Export Plan, or its Plan and Register files.
      </p>
      <button
        type="button"
        ref={buttonRef}
        className="plan-import-dialog-drop"
        aria-describedby={sentence}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFiles([...e.dataTransfer.files]);
        }}
      >
        <span className="plan-import-dialog-drop-main">Drop the files here</span>
        <span className="plan-import-dialog-drop-sub">or choose them from your computer</span>
      </button>
      <input
        ref={input}
        id="plan-import-file"
        type="file"
        multiple
        accept=".zip,.csv,.tsv"
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          onFiles(list);
        }}
      />
      {error ? (
        <p role="alert" className="plan-import-dialog-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
