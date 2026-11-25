import {
  FILE_DATE_FORMATS,
  FILE_IMPORT_COPY,
  type FileDateFormat,
  type FileImportDateQuestion,
} from "@budget/schema/file-import";
import { useState } from "react";
import { InfoCircleFillIcon } from "../register/icons";

/**
 * The amber ⓘ that shows while the file's date format is unclear, and its popover: what the first date reads, the
 * 13 formats and Save. The owner (dialog 2) holds `open`, so Escape closes the popover before the dialog.
 */
export function FileImportDate({
  fileName,
  question,
  open,
  onOpen,
  onSave,
}: {
  fileName: string;
  question: FileImportDateQuestion;
  open: boolean;
  onOpen: (open: boolean) => void;
  onSave: (format: FileDateFormat) => void;
}) {
  const [format, setFormat] = useState<FileDateFormat>(question.formats[0] ?? FILE_DATE_FORMATS[0]);
  return (
    <span className="file-import-date">
      <button
        type="button"
        className="file-import-date-icon"
        aria-label="Date format unclear"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <InfoCircleFillIcon />
      </button>
      {open ? (
        <div className="file-import-date-pop" role="dialog" aria-label="Date format">
          <p>{FILE_IMPORT_COPY.unclearDate(fileName, question.first_value)}</p>
          <select
            aria-label="Date format"
            value={format}
            onChange={(e) => setFormat(e.target.value as FileDateFormat)}
          >
            {question.formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button type="button" className="file-import-save" onClick={() => onSave(format)}>
            {FILE_IMPORT_COPY.save}
          </button>
        </div>
      ) : null}
    </span>
  );
}
