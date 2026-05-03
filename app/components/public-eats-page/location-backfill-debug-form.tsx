'use client';

import { useFormStatus } from 'react-dom';
import { backfillRestaurantLocationFromRoot } from '@/app/actions';
import styles from './style.module.scss';

type LocationBackfillDebugFormProps = {
  restaurantId: string;
};

const LocationBackfillDebugButton = (): JSX.Element => {
  const { pending } = useFormStatus();

  return (
    <button className={styles.debugButton} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? 'Backfilling...' : 'Backfill map'}
    </button>
  );
};

export function LocationBackfillDebugForm({ restaurantId }: LocationBackfillDebugFormProps): JSX.Element {
  return (
    <form action={backfillRestaurantLocationFromRoot} className={styles.inlineDebugForm}>
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <LocationBackfillDebugButton />
    </form>
  );
}
