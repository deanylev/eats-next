'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './style.module.scss';

type BackfillTarget = {
  id: string;
  name: string;
};

type BackfillResult = {
  id: string;
  name: string;
  result: 'updated' | 'skipped' | 'failed';
};

type BackfillSummary = {
  failed: number;
  skipped: number;
  updated: number;
};

const zeroSummary = (): BackfillSummary => ({
  failed: 0,
  skipped: 0,
  updated: 0
});

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {}

  return 'Something went wrong. Please try again.';
};

export function LocationBackfillProgressButton(): JSX.Element {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [summary, setSummary] = useState<BackfillSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runBackfill = async (): Promise<void> => {
    if (!window.confirm('Backfill saved address and coordinates for active restaurants with Google Maps URLs? This may make many Google Maps API requests.')) {
      return;
    }

    setIsRunning(true);
    setCheckedCount(0);
    setTotalCount(0);
    setCurrentName(null);
    setSummary(null);
    setErrorMessage(null);

    try {
      const queueResponse = await fetch('/api/admin/location-backfill', {
        cache: 'no-store'
      });
      if (!queueResponse.ok) {
        throw new Error(await getErrorMessage(queueResponse));
      }

      const queuePayload = (await queueResponse.json()) as { restaurants?: BackfillTarget[] };
      const restaurants = queuePayload.restaurants ?? [];
      const nextSummary = zeroSummary();
      setTotalCount(restaurants.length);

      if (restaurants.length === 0) {
        setSummary(nextSummary);
        return;
      }

      for (let index = 0; index < restaurants.length; index += 1) {
        const restaurant = restaurants[index];
        setCurrentName(restaurant.name);

        const response = await fetch('/api/admin/location-backfill', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ restaurantId: restaurant.id })
        });

        if (!response.ok) {
          throw new Error(await getErrorMessage(response));
        }

        const payload = (await response.json()) as BackfillResult;
        nextSummary[payload.result] += 1;
        setSummary({ ...nextSummary });
        setCheckedCount(index + 1);
      }

      setCurrentName(null);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setIsRunning(false);
    }
  };

  const progressPercent = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  return (
    <div className={styles.locationBackfillProgress}>
      <button type="button" onClick={runBackfill} disabled={isRunning}>
        {isRunning ? 'Backfilling map data...' : 'Backfill map data'}
      </button>
      {isRunning || totalCount > 0 || summary ? (
        <div className={styles.locationBackfillStatus} aria-live="polite">
          {totalCount > 0 ? (
            <div className={styles.locationBackfillProgressBar} aria-hidden="true">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          ) : null}
          <div>
            {totalCount === 0 && summary
              ? 'No places need backfill.'
              : `${checkedCount} / ${totalCount} checked${currentName ? ` - ${currentName}` : ''}`}
          </div>
          {summary && totalCount > 0 ? (
            <div>
              Updated {summary.updated}, skipped {summary.skipped}, failed {summary.failed}.
            </div>
          ) : null}
        </div>
      ) : null}
      {errorMessage ? <div className={styles.locationBackfillError}>{errorMessage}</div> : null}
    </div>
  );
}
