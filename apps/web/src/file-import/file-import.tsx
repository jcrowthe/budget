import type { Account } from "@budget/schema/accounts";
import { FILE_IMPORT_COPY, type FileImportResult } from "@budget/schema/file-import";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useSaveUiState, useUiState } from "../api/ui-state";
import { useOpenAccounts } from "../register/openAccounts";
import { FileImportDialog } from "./file-import-dialog";
import { FileImportPreview } from "./file-import-preview";
import { FileImportResultDialog } from "./file-import-result";

export interface FileImportHandle {
  /** The toolbar's click: dialog 1, or the file chooser at once when "Don't show again" was set. */
  open: () => void;
}

type Step =
  | { kind: "closed" }
  | { kind: "intro"; error: string | null }
  | { kind: "preview"; file: File; accountId: string }
  | { kind: "result"; result: FileImportResult };

const TOOLBAR_BUTTON = '.register-toolbar button[data-ticket="EXF-531"]';

/**
 * The three File Import dialogs in turn (EXF-531), and the one hidden file input they share. The input is always
 * mounted so that "Choose File" and the toolbar's own click open the chooser with their user activation.
 */
export const FileImport = forwardRef<FileImportHandle, { budgetId: string; account?: Account }>(
  function FileImport({ budgetId, account }, ref) {
    const [step, setStep] = useState<Step>({ kind: "closed" });
    const [dontShow, setDontShow] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const back = useRef<HTMLElement | null>(null);
    const ui = useUiState(budgetId);
    const saveUi = useSaveUiState(budgetId);
    const { openAccounts } = useOpenAccounts(budgetId);

    const returnTo = () => back.current ?? document.querySelector<HTMLElement>(TOOLBAR_BUTTON);
    const close = () => setStep({ kind: "closed" });
    const choose = () => input.current?.click();

    useImperativeHandle(ref, () => ({
      open: () => {
        const el = document.activeElement;
        back.current = el instanceof HTMLElement && el !== document.body ? el : null;
        setDontShow(false);
        if (ui.data?.hide_file_import_dialog) choose();
        else setStep({ kind: "intro", error: null });
      },
    }));

    const onFile = (file: File | undefined) => {
      if (input.current) input.current.value = "";
      if (!file) return;
      const accountId = account?.id ?? openAccounts[0]?.id;
      if (!accountId) return;
      if (dontShow) saveUi.mutate({ hide_file_import_dialog: true });
      setStep({ kind: "preview", file, accountId });
    };

    return (
      <>
        <input
          ref={input}
          type="file"
          hidden
          data-file-import-input
          accept={FILE_IMPORT_COPY.accept}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {step.kind === "intro" ? (
          <FileImportDialog
            error={step.error}
            dontShow={dontShow}
            onDontShow={setDontShow}
            onChoose={choose}
            onClose={close}
            returnTo={returnTo}
          />
        ) : null}
        {step.kind === "preview" ? (
          <FileImportPreview
            budgetId={budgetId}
            file={step.file}
            accounts={openAccounts}
            initialAccountId={step.accountId}
            onFailed={(error) => setStep({ kind: "intro", error })}
            onClose={close}
            onDone={(result) => setStep({ kind: "result", result })}
            returnTo={returnTo}
          />
        ) : null}
        {step.kind === "result" ? (
          <FileImportResultDialog result={step.result} onClose={close} returnTo={returnTo} />
        ) : null}
      </>
    );
  },
);
