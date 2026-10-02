import type { Field, FieldErrors, FieldValues } from "./input-validation";

export type CountryOption = { code: string; name: string };

// The first name, last name and country inputs shared by the screening and watchlist forms.
export function PersonFields({
  values,
  errors,
  countries,
  onChange,
}: {
  values: FieldValues;
  errors: FieldErrors;
  countries: readonly CountryOption[];
  onChange: (field: Field, value: string) => void;
}) {
  return (
    <>
      <label>
        First name
        <input
          name="firstName"
          autoComplete="off"
          maxLength={100}
          value={values.firstName}
          onChange={(event) => onChange("firstName", event.target.value)}
          aria-invalid={errors.firstName !== undefined}
        />
        {errors.firstName && <span className="field-error">{errors.firstName}</span>}
      </label>
      <label>
        Last name
        <input
          name="lastName"
          autoComplete="off"
          maxLength={100}
          value={values.lastName}
          onChange={(event) => onChange("lastName", event.target.value)}
          aria-invalid={errors.lastName !== undefined}
        />
        {errors.lastName && <span className="field-error">{errors.lastName}</span>}
      </label>
      <label>
        Country
        <select
          name="country"
          value={values.country}
          onChange={(event) => onChange("country", event.target.value)}
          aria-invalid={errors.country !== undefined}
        >
          <option value="">Select a country</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name} ({country.code})
            </option>
          ))}
        </select>
        {errors.country && <span className="field-error">{errors.country}</span>}
      </label>
    </>
  );
}
