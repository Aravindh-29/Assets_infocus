import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { errorMessage } from '../services/api';
export type Field = {
  name: string;
  label: string;
  type?:
    'text' | 'email' | 'password' | 'number' | 'date' | 'datetime-local' | 'select' | 'textarea' | 'checkbox';
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: any;
  placeholder?: string;
  help?: string;
  minLength?: number;
  full?: boolean;
  section?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
};
export function RecordForm({
  fields,
  initial = {},
  onSubmit,
  onCancel,
  submitLabel = 'Save changes',
  children,
}: {
  fields: Field[];
  initial?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  children?: React.ReactNode;
}) {
  const schema = useMemo(
    () =>
      z.object(
        Object.fromEntries(
          fields.map((field) => {
            let validator: any = field.type === 'checkbox' ? z.boolean() : z.string();
            if (field.type !== 'checkbox') {
              if (field.required) validator = validator.min(1, `${field.label} is required`);
              if (field.minLength)
                validator = validator.refine(
                  (v: string) => !v || v.length >= field.minLength!,
                  `Use at least ${field.minLength} characters`,
                );
              if (field.type === 'email')
                validator = validator.refine(
                  (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
                  'Enter a valid email address',
                );
              if (field.type === 'number')
                validator = validator.refine(
                  (v: string) =>
                    !v ||
                    (Number.isFinite(Number(v)) &&
                      (field.min === undefined || Number(v) >= field.min) &&
                      (field.max === undefined || Number(v) <= field.max)),
                  'Enter a valid number in the allowed range',
                );
            }
            return [field.name, validator];
          }),
        ),
      ),
    [fields],
  );
  const defaults = Object.fromEntries(
    fields.map((f) => {
      const value = initial[f.name] ?? f.defaultValue ?? (f.type === 'checkbox' ? false : '');
      return [
        f.name,
        f.type === 'date' && value
          ? String(value).slice(0, 10)
          : f.type === 'datetime-local' && value
            ? String(value).slice(0, 16)
            : f.type === 'checkbox'
              ? Boolean(value)
              : String(value),
      ];
    }),
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaults });
  const [error, setError] = useState('');
  return (
    <form
      aria-busy={isSubmitting}
      onSubmit={handleSubmit(async (values) => {
        setError('');
        try {
          await onSubmit(values);
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
      className="record-form"
    >
      <div className="form-fields">
        {fields.map((f) => (
          <div className={f.full || f.type === 'textarea' || f.section ? 'field full' : 'field'} key={f.name}>
            {f.section && <h3 className="form-section">{f.section}</h3>}
            {f.type === 'checkbox' ? (
              <label className="checkbox-label">
                <input type="checkbox" {...register(f.name)} disabled={f.disabled || isSubmitting} />
                {f.label}
              </label>
            ) : (
              <>
                <label htmlFor={`field-${f.name}`}>
                  {f.label}
                  {f.required && (
                    <span className="required" aria-hidden="true">
                      {' '}
                      *
                    </span>
                  )}
                </label>
                {f.type === 'select' ? (
                  <select
                    id={`field-${f.name}`}
                    {...register(f.name)}
                    aria-label={f.label}
                    aria-required={f.required || undefined}
                    aria-invalid={Boolean(errors[f.name])}
                    disabled={f.disabled || isSubmitting}
                  >
                    <option value="">Select {f.label.toLowerCase()}</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    disabled={f.disabled || isSubmitting}
                    id={`field-${f.name}`}
                    aria-label={f.label}
                    aria-required={f.required || undefined}
                    rows={3}
                    {...register(f.name)}
                    placeholder={f.placeholder}
                    aria-invalid={Boolean(errors[f.name])}
                  />
                ) : (
                  <input
                    id={`field-${f.name}`}
                    aria-label={f.label}
                    aria-required={f.required || undefined}
                    type={f.type ?? 'text'}
                    step={f.type === 'number' ? 'any' : undefined}
                    min={f.min}
                    max={f.max}
                    {...register(f.name)}
                    disabled={f.disabled || isSubmitting}
                    autoComplete={f.type === 'password' ? 'new-password' : undefined}
                    placeholder={f.placeholder}
                    aria-invalid={Boolean(errors[f.name])}
                  />
                )}
              </>
            )}
            {f.help && <small>{f.help}</small>}
            {errors[f.name] && (
              <small className="field-error" role="alert">
                {String(errors[f.name]?.message)}
              </small>
            )}
          </div>
        ))}
      </div>
      {children}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
        )}
        <button className="btn primary" disabled={isSubmitting} type="submit">
          {isSubmitting && <Loader2 size={16} className="spin" />}
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
