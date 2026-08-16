"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, Plus, X, Check } from "lucide-react";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { bookAppointmentAction, registerWalkInAction, type WalkInState } from "../actions";
import {
  VISIT_TYPES,
  VISIT_TYPE_LABEL,
  type AppointmentActionState,
} from "../schema";
import type { BookableDoctor, BookablePatient } from "../queries";

const bookInitial: AppointmentActionState = { ok: false };
const walkInInitial: WalkInState = { ok: false };

export interface BookingPanelProps {
  doctors: BookableDoctor[];
  /** The signed-in user's own doctor id, if they are a doctor here. */
  ownDoctorId: string | null;
  /** Reception picks a doctor; a doctor books only for themselves. */
  mustChooseDoctor: boolean;
  searchPatients: (term: string, ownerDoctorId?: string) => Promise<
    { ok: true; patients: BookablePatient[] } | { ok: false; reason: string }
  >;
  defaultDate: string;
}

/**
 * Booking, in the order the desk actually works: who is it for, then who are
 * they, then when.
 *
 * The doctor is chosen FIRST when reception is booking, because it scopes
 * everything after it — the patient search, and who ends up owning a walk-in.
 */
export function BookingPanel({
  doctors,
  ownDoctorId,
  mustChooseDoctor,
  searchPatients,
  defaultDate,
}: BookingPanelProps) {
  const [open, setOpen] = React.useState(false);
  const [doctorId, setDoctorId] = React.useState(ownDoctorId ?? doctors[0]?.doctorId ?? "");
  const [patient, setPatient] = React.useState<BookablePatient | null>(null);
  const [registering, setRegistering] = React.useState(false);

  const reset = React.useCallback(() => {
    setOpen(false);
    setPatient(null);
    setRegistering(false);
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
      >
        <Plus className="size-4" aria-hidden="true" />
        Book an appointment
      </button>
    );
  }

  return (
    <section className="clinical-surface space-y-4 rounded-glass p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">New appointment</h2>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <X className="size-4" aria-hidden="true" />
          Close
        </button>
      </div>

      {mustChooseDoctor ? (
        <div className="space-y-1.5">
          <label htmlFor="book-doctor" className="block text-[13px] font-medium text-ink">
            Which doctor is this for?
          </label>
          <select
            id="book-doctor"
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              setPatient(null); // the patient list is scoped to the doctor
            }}
            className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
          >
            <option value="" disabled>
              Choose a doctor
            </option>
            {doctors.map((d) => (
              <option key={d.doctorId} value={d.doctorId}>
                {d.fullName}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            The patient will belong to this doctor. Their records stay separate
            from every other doctor here.
          </p>
        </div>
      ) : null}

      {!doctorId ? (
        <p className="text-[13px] text-ink-secondary">Choose a doctor to continue.</p>
      ) : patient ? (
        <BookingDetails
          patient={patient}
          doctorId={doctorId}
          defaultDate={defaultDate}
          onChangePatient={() => setPatient(null)}
          onBooked={reset}
        />
      ) : registering ? (
        <WalkInForm
          doctorId={doctorId}
          onRegistered={(p) => {
            setPatient(p);
            setRegistering(false);
          }}
          onCancel={() => setRegistering(false)}
        />
      ) : (
        <PatientSearch
          // Remount when the doctor changes: results are scoped to one
          // repository, and showing the previous doctor's matches would be a
          // cross-doctor leak in appearance if not in fact.
          key={doctorId}
          doctorId={doctorId}
          searchPatients={searchPatients}
          onPick={setPatient}
          onRegisterNew={() => setRegistering(true)}
        />
      )}
    </section>
  );
}

function PatientSearch({
  doctorId,
  searchPatients,
  onPick,
  onRegisterNew,
}: {
  doctorId: string;
  searchPatients: BookingPanelProps["searchPatients"];
  onPick: (p: BookablePatient) => void;
  onRegisterNew: () => void;
}) {
  const [term, setTerm] = React.useState("");
  const [results, setResults] = React.useState<BookablePatient[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef(0);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * Debounced in the event handler rather than an effect.
   *
   * Every keystroke hitting the database would be wasteful and, on a slow desk
   * connection, would deliver results out of order — `latest` discards any
   * response that has been overtaken.
   */
  const onTermChange = (value: string) => {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);

    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setFailed(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    const ticket = ++latest.current;
    timer.current = setTimeout(async () => {
      const outcome = await searchPatients(q, doctorId);
      if (ticket !== latest.current) return; // a newer search has already landed
      setSearching(false);
      if (outcome.ok) {
        setResults(outcome.patients);
        setFailed(false);
      } else {
        setResults([]);
        setFailed(true);
      }
    }, 300);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="book-search" className="block text-[13px] font-medium text-ink">
          Who is the appointment for?
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <input
            id="book-search"
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            placeholder="Search by name, phone or patient number"
            className="h-11 w-full rounded-xl border border-hairline bg-white pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring"
          />
        </div>
      </div>

      {/*
        A failed search is NOT "no such patient". Saying so would send the desk
        straight to registering a duplicate.
      */}
      {failed ? (
        <p className="rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-[#a81c1c]">
          Patient search is unavailable right now. Do not register a new record
          for someone who may already exist — try again in a moment.
        </p>
      ) : null}

      {searching ? <p className="text-[13px] text-ink-muted">Searching…</p> : null}

      {results.length > 0 ? (
        <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:focus-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{p.fullName}</span>
                  <span className="block text-xs tabular-nums text-ink-secondary">
                    {p.patientNumber}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </span>
                </span>
                <Check className="size-4 shrink-0 text-brand" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {term.trim().length >= 2 && !searching && !failed && results.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">
          No match in this doctor&apos;s records.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onRegisterNew}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand bg-white px-4 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft focus-visible:focus-ring"
      >
        <UserPlus className="size-4" aria-hidden="true" />
        Register someone new
      </button>
    </div>
  );
}

/** Reception registering a walk-in. Demographics only — see ADR 0008. */
function WalkInForm({
  doctorId,
  onRegistered,
  onCancel,
}: {
  doctorId: string;
  onRegistered: (p: BookablePatient) => void;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(registerWalkInAction, walkInInitial);
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok && state.patientId) {
      onRegistered({
        id: state.patientId,
        fullName: state.patientName ?? "New patient",
        patientNumber: state.patientNumber ?? "",
        phone: state.values?.phone ?? null,
        ownerDoctorId: doctorId,
      });
      router.refresh();
    }
  }, [
    state.ok,
    state.patientId,
    state.patientNumber,
    state.patientName,
    state.values,
    doctorId,
    onRegistered,
    router,
  ]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="ownerDoctorId" value={doctorId} />

      <Field
        label="Full name"
        name="fullName"
        defaultValue={state.values?.fullName ?? ""}
        errors={state.fieldErrors?.fullName}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Age"
          name="approxAgeYears"
          type="number"
          required={false}
          defaultValue={state.values?.approxAgeYears ?? ""}
          errors={state.fieldErrors?.approxAgeYears}
          hint="Years. An exact date of birth can be added later."
        />
        <div className="space-y-1.5">
          <label htmlFor="walkin-sex" className="block text-[13px] font-medium text-ink">
            Sex
          </label>
          <select
            id="walkin-sex"
            name="sex"
            defaultValue={state.values?.sex ?? "UNKNOWN"}
            className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
          >
            <option value="UNKNOWN">Not recorded</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      <Field
        label="Phone"
        name="phone"
        type="tel"
        required={false}
        defaultValue={state.values?.phone ?? ""}
      />
      <Field
        label="District"
        name="district"
        required={false}
        defaultValue={state.values?.district ?? ""}
      />

      <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-xs text-ink-secondary">
        Reception records contact details only. Allergies, conditions and
        medicines are added by the doctor during the consultation.
      </p>

      {/*
        Said plainly because it is two steps, not one transaction: if the
        booking afterwards fails, this patient still exists. Better that than
        losing a real person who is standing at the desk.
      */}
      <p className="text-xs text-ink-muted">
        This registers the patient. You will choose the appointment time next —
        the record is kept either way.
      </p>

      <FormMessage state={state} />

      {/*
        Matches reception CAN see. Picking one is nearly always right, so it is
        offered first — but two people genuinely share a name and a household
        phone, so an override exists for the case they can actually judge.
      */}
      {state.duplicates && state.duplicates.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-warning-soft bg-warning-soft/40 p-3">
          <p className="text-[13px] font-semibold text-ink">
            Already registered with this doctor
          </p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-white">
            {state.duplicates.map((d) => (
              <li key={d.id} className="px-3 py-2.5 text-[13px]">
                <span className="font-semibold text-ink">{d.fullName}</span>
                <span className="ml-2 tabular-nums text-ink-secondary">
                  {d.patientNumber}
                  {d.phone ? ` · ${d.phone}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-secondary">
            If one of these is the same person, close this form and search for
            them instead — a second record splits their history.
          </p>
          <label className="flex items-start gap-2.5 py-1 text-[13px] text-ink">
            <input
              type="checkbox"
              name="confirmedNotDuplicate"
              className="mt-0.5 size-4 shrink-0 rounded border-hairline text-brand focus-visible:focus-ring"
            />
            I have checked — this is a different person
          </label>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:max-w-md">
        <SubmitButton>Register patient</SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
        >
          Back to search
        </button>
      </div>
    </form>
  );
}

function BookingDetails({
  patient,
  doctorId,
  defaultDate,
  onChangePatient,
  onBooked,
}: {
  patient: BookablePatient;
  doctorId: string;
  defaultDate: string;
  onChangePatient: () => void;
  onBooked: () => void;
}) {
  const [state, formAction] = useActionState(bookAppointmentAction, bookInitial);
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onBooked();
    }
  }, [state.ok, router, onBooked]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="patientId" value={patient.id} />
      <input type="hidden" name="ownerDoctorId" value={doctorId} />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-soft px-3.5 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{patient.fullName}</span>
          <span className="block text-xs tabular-nums text-ink-secondary">
            {patient.patientNumber}
          </span>
        </span>
        <button
          type="button"
          onClick={onChangePatient}
          className="text-[13px] font-semibold text-brand hover:underline focus-visible:focus-ring"
        >
          Change
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="book-when" className="block text-[13px] font-medium text-ink">
            Date and time
          </label>
          <input
            id="book-when"
            name="scheduledFor"
            type="datetime-local"
            required
            defaultValue={state.values?.scheduledFor ?? `${defaultDate}T10:00`}
            className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
          />
          {state.fieldErrors?.scheduledFor ? (
            <p className="text-xs font-medium text-danger">{state.fieldErrors.scheduledFor[0]}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="book-duration" className="block text-[13px] font-medium text-ink">
            Length
          </label>
          <select
            id="book-duration"
            name="durationMinutes"
            defaultValue="15"
            className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
          >
            {[10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="book-visit" className="block text-[13px] font-medium text-ink">
          Type of visit
        </label>
        <select
          id="book-visit"
          name="visitType"
          defaultValue="NEW"
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
        >
          {VISIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {VISIT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="book-reason" className="block text-[13px] font-medium text-ink">
          Reason <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id="book-reason"
          name="reason"
          maxLength={300}
          placeholder="In the patient's own words, e.g. chest pain for three days"
          defaultValue={state.values?.reason ?? ""}
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring"
        />
      </div>

      <FormMessage state={state} />

      <div className="sm:max-w-56">
        <SubmitButton>Book appointment</SubmitButton>
      </div>
    </form>
  );
}
