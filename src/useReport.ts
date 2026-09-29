import { useEffect, useRef, useState } from "react";
import type { AnalysisResult } from "./types";
import { jsonApi, jsonBody, HttpError } from "./api";
export interface SavedResult extends AnalysisResult {
  reportId?: string;
  revision?: number;
  sourceUrl?: string;
  updatedAt?: string;
  mediaStatus?: string;
  saveWarning?: string;
  mediaErrors?: Array<{
    name: string;
    kind: string;
    rowId?: string;
    message: string;
  }>;
}
export type ReportSaveState =
  | "unsaved"
  | "saving"
  | "saved"
  | "partial"
  | "error"
  | "conflict";
type SaveMethod = "automatic" | "manual";
const fingerprint = (result: AnalysisResult, title: string) =>
  JSON.stringify({
    title,
    rows: result.rows,
    mapping: result.mapping,
    summary: result.summary,
    parameters: result.parameters,
    tsvHeaders: result.tsvHeaders,
    excelHeaders: result.excelHeaders,
    sheets: result.sheets,
  });
export function useReport(result: AnalysisResult | null, title: string) {
  const [id, setId] = useState<string | null>(null),
    [status, setStatus] = useState<ReportSaveState>("unsaved"),
    [saving, setSaving] = useState(false),
    [saveMethod, setSaveMethod] = useState<SaveMethod | null>(null),
    [savedAt, setSavedAt] = useState<string | null>(null),
    [errorMessage, setErrorMessage] = useState(""),
    [conflict, setConflict] = useState(false),
    [refresh, setRefresh] = useState(0);
  const latest = useRef({ result, title });
  latest.current = { result, title };
  const tracking = useRef({
    id: null as string | null,
    revision: 0,
    fingerprint: "",
    key: crypto.randomUUID(),
  });
  const flight = useRef<Promise<void> | null>(null),
    alive = useRef(true),
    blocked = useRef(false);
  const pendingFiles = useRef<File[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function adopt(
    payload: SavedResult,
    reportTitle: string,
    files: File[] = [],
  ) {
    pendingFiles.current = payload.reportId ? [] : files;
    blocked.current = false;
    setConflict(false);
    tracking.current = {
      id: payload.reportId ?? null,
      revision: payload.revision ?? 0,
      fingerprint: payload.reportId ? fingerprint(payload, reportTitle) : "",
      key: crypto.randomUUID(),
    };
    setId(payload.reportId ?? null);
    setSavedAt(payload.updatedAt ?? null);
    setSaving(false);
    setSaveMethod(null);
    setErrorMessage(payload.saveWarning ?? "");
    setStatus(
      payload.reportId &&
        (payload.mediaStatus === "failed" || payload.saveWarning)
        ? "partial"
        : payload.saveWarning
          ? "error"
          : payload.reportId
            ? "saved"
            : "unsaved",
    );
    setRefresh((v) => v + 1);
  }
  async function saveNow(method: SaveMethod = "manual"): Promise<void> {
    if (flight.current) {
      await flight.current;
      return saveNow(method);
    }
    if (blocked.current)
      throw new Error("Báo cáo bị xung đột. Tải lại trước khi lưu.");
    const run = async () => {
      while (alive.current) {
        const snapshot = latest.current;
        if (!snapshot.result) return;
        const mark = fingerprint(snapshot.result, snapshot.title);
        if (
          mark === tracking.current.fingerprint &&
          !pendingFiles.current.length
        )
          return;
        if (!snapshot.title.trim())
          throw new Error("Cần nhập tiêu đề trước khi lưu.");
        setSaving(true);
        setSaveMethod(method);
        setStatus("saving");
        setErrorMessage("");
        const prior = tracking.current;
        const answer =
          mark === prior.fingerprint
            ? ({} as SavedResult)
            : await jsonApi<SavedResult>(
                prior.id ? `/api/reports/${prior.id}` : "/api/reports",
                {
                  ...jsonBody(
                    {
                      title: snapshot.title,
                      result: snapshot.result,
                      revision: prior.revision,
                    },
                    prior.id ? "PATCH" : "POST",
                  ),
                  headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": prior.key,
                  },
                },
              );
        if (!alive.current || tracking.current !== prior) return;
        tracking.current = {
          ...prior,
          id: answer.reportId ?? prior.id,
          revision: answer.revision ?? prior.revision,
          fingerprint: mark,
        };
        setId(tracking.current.id);
        if (answer.updatedAt || mark !== prior.fingerprint)
          setSavedAt(answer.updatedAt ?? new Date().toISOString());
        const active = tracking.current;
        const files = pendingFiles.current;
        while (files.length && active.id) {
          const file = files[0],
            body = new FormData();
          body.append("file", file);
          body.append(
            "kind",
            file.name.toLowerCase().endsWith(".tsv")
              ? "source_tsv"
              : "source_xlsx",
          );
          const uploaded = await jsonApi<{ saveWarning?: string }>(
            `/api/reports/${active.id}/assets`,
            { method: "POST", body },
          );
          if (uploaded.saveWarning) throw new Error(uploaded.saveWarning);
          if (tracking.current !== active) return;
          files.shift();
        }
        const partial = Boolean(
          answer.saveWarning || answer.mediaStatus === "failed",
        );
        setStatus(partial ? "partial" : "saved");
        setErrorMessage(answer.saveWarning ?? "");
        setRefresh((v) => v + 1);
      }
    };
    flight.current = run()
      .catch((e) => {
        if (alive.current) {
          setErrorMessage((e as Error).message);
          if (e instanceof HttpError && e.code === "REVISION_CONFLICT") {
            blocked.current = true;
            setConflict(true);
            setStatus("conflict");
          } else {
            setStatus("error");
          }
        }
        throw e;
      })
      .finally(() => {
        flight.current = null;
        if (alive.current) setSaving(false);
      });
    await flight.current;
  }
  useEffect(() => {
    if (
      !result ||
      blocked.current ||
      fingerprint(result, title) === tracking.current.fingerprint
    )
      return;
    setStatus("unsaved");
    setErrorMessage("");
    const timer = setTimeout(
      () => void saveNow("automatic").catch(() => {}),
      1000,
    );
    return () => clearTimeout(timer);
  }, [result, title]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (
        latest.current.result &&
        (fingerprint(latest.current.result, latest.current.title) !==
          tracking.current.fingerprint ||
          pendingFiles.current.length > 0)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  return {
    id,
    status,
    saving,
    saveMethod,
    savedAt,
    errorMessage,
    conflict,
    refresh,
    adopt,
    saveNow,
    refreshMedia: async () => {
      const prior = tracking.current;
      if (!prior.id) return;
      const answer = await jsonApi<SavedResult>(`/api/reports/${prior.id}`);
      if (
        tracking.current !== prior ||
        !alive.current ||
        !latest.current.result ||
        fingerprint(latest.current.result, latest.current.title) !==
          prior.fingerprint
      )
        return;
      setStatus(answer.mediaStatus === "ready" ? "saved" : "partial");
      setErrorMessage(
        answer.mediaStatus === "ready"
          ? ""
          : "Kết quả đã lưu, nhưng ảnh/file chưa lưu đủ. Hãy thử lại trong mục Ảnh và file.",
      );
    },
    getRevision: () => tracking.current.revision,
    getId: () => tracking.current.id,
    dirty: () =>
      !!latest.current.result &&
      (fingerprint(latest.current.result, latest.current.title) !==
        tracking.current.fingerprint ||
        !!pendingFiles.current.length),
  };
}
