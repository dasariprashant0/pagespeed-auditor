export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-5">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-medium tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[12px] text-[var(--muted)]">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-4 text-[12px] text-[var(--muted)]">{footer}</div>}
      </div>
    </main>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  required = true,
  autoComplete,
  defaultValue,
  readOnly,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  readOnly?: boolean;
  hint?: string;
}) {
  const id = `f-${name}`;
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        readOnly={readOnly}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-[13px] ${
          readOnly ? 'text-[var(--muted)]' : ''
        }`}
      />
      {hint && (
        <span id={`${id}-hint`} className="mt-1 block text-[10px] text-[var(--muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full rounded-[5px] bg-[var(--foreground)] px-3 py-2 text-[13px] font-medium text-[var(--background)] disabled:opacity-50"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[12px]" style={{ color: 'var(--score-fail-text)' }}>
      {message}
    </p>
  );
}
