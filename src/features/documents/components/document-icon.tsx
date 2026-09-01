import * as React from "react";
import {
  FlaskConical,
  ScanLine,
  Pill,
  ClipboardList,
  Forward,
  BadgeCheck,
  FileText,
} from "lucide-react";
import type { DocumentType } from "../types";

/**
 * One icon per document type, in one place.
 *
 * A doctor scanning a list of thirty reports finds "the scan" by shape before
 * they read a word — but the shape is never the only signal: every row prints
 * the type as text beside it. Icon plus text, the same rule as StatusBadge.
 */
const ICONS: Record<DocumentType, React.ComponentType<{ className?: string }>> = {
  LAB_REPORT: FlaskConical,
  IMAGING_REPORT: ScanLine,
  PREVIOUS_PRESCRIPTION: Pill,
  DISCHARGE_SUMMARY: ClipboardList,
  REFERRAL: Forward,
  MEDICAL_CERTIFICATE: BadgeCheck,
  OTHER: FileText,
};

export function DocumentIcon({
  type,
  className,
}: {
  type: DocumentType;
  className?: string;
}) {
  const Icon = ICONS[type] ?? FileText;
  return <Icon className={className} />;
}
