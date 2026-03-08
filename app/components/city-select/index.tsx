'use client';

import { byAlpha } from '@/app/components/public-eats-page/utils';

export type CitySelectGroup = {
  countryName: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};

type CitySelectProps = {
  groups: CitySelectGroup[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export const buildCitySelectGroups = (
  cities: Array<{ countryName: string; label?: string; name: string; value: string }>
): CitySelectGroup[] => {
  const countryMap = new Map<string, Array<{ label: string; value: string }>>();

  for (const city of cities) {
    const options = countryMap.get(city.countryName) ?? [];
    options.push({
      label: city.label ?? city.name,
      value: city.value
    });
    countryMap.set(city.countryName, options);
  }

  return [...countryMap.entries()]
    .sort(([countryA], [countryB]) => byAlpha(countryA, countryB))
    .map(([countryName, options]) => ({
      countryName,
      options: options.sort((optionA, optionB) => byAlpha(optionA.label, optionB.label))
    }));
};

export function CitySelect({
  groups,
  value,
  onChange,
  id,
  name,
  required = false,
  disabled = false,
  placeholder
}: CitySelectProps) {
  return (
    <select
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {groups.map((group) => (
        <optgroup key={group.countryName} label={group.countryName}>
          {group.options.map((option) => (
            <option key={`${group.countryName}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
