'use client';

import { deleteCity, deleteCountry, deleteRestaurantType } from '@/app/actions';

type EntityType = 'country' | 'city' | 'type';

type AdminEntityDeleteFormProps = {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  buttonLabel: string;
};

const getAction = (entityType: EntityType) => {
  if (entityType === 'country') {
    return deleteCountry;
  }

  if (entityType === 'city') {
    return deleteCity;
  }

  return deleteRestaurantType;
};

const getIdFieldName = (entityType: EntityType): 'countryId' | 'cityId' | 'typeId' => {
  if (entityType === 'country') {
    return 'countryId';
  }

  if (entityType === 'city') {
    return 'cityId';
  }

  return 'typeId';
};

export function AdminEntityDeleteForm({
  entityType,
  entityId,
  entityName,
  buttonLabel
}: AdminEntityDeleteFormProps) {
  const action = getAction(entityType);
  const idFieldName = getIdFieldName(entityType);
  const confirmText = `Delete "${entityName}"? This cannot be undone.`;

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(confirmText);
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name={idFieldName} value={entityId} />
      <button data-delete-button="true" type="submit">
        {buttonLabel}
      </button>
    </form>
  );
}
