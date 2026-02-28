import { cookies } from 'next/headers';
import {
  createCity,
  createCountry,
  createRestaurant,
  createRestaurantType,
  getCmsData
} from '@/app/actions';
import { ErrorConfirm } from '@/app/components/error-confirm';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { RestaurantFormFields } from '@/app/components/restaurant-form-fields';
import { SuccessConfirm } from '@/app/components/success-confirm';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const data = await getCmsData();
  const cookieStore = cookies();
  const encodedErrorMessage = cookieStore.get('admin_error_message')?.value ?? null;
  const encodedSuccessMessage = cookieStore.get('admin_success_message')?.value ?? null;
  const errorMessage = encodedErrorMessage ? decodeURIComponent(encodedErrorMessage) : null;
  const successMessage = encodedSuccessMessage ? decodeURIComponent(encodedSuccessMessage) : null;

  return (
    <div className={styles.root}>
      <main>
        <header className={styles.hero}>
          <h1>Restaurants CMS</h1>
          <p>Manage countries, cities, types, and restaurants.</p>
        </header>
        <ErrorConfirm message={errorMessage} />
        <SuccessConfirm message={successMessage} />

        <div className={styles.builderGrid}>
          <section className={styles.panel}>
            <h2>Add Country</h2>
            <form action={createCountry}>
              <label>
                Country name
                <input name="name" required />
              </label>
              <button type="submit">Create country</button>
            </form>
          </section>

          <section className={styles.panel}>
            <h2>Add City</h2>
            <form action={createCity}>
              <label>
                City name
                <input name="name" required />
              </label>
              <label>
                Country
                <select name="countryId" required defaultValue="">
                  <option value="" disabled>
                    Select country
                  </option>
                  {data.countries.map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={data.countries.length === 0}>
                Create city
              </button>
            </form>
          </section>

          <section className={styles.panel}>
            <h2>Add Restaurant Type</h2>
            <form action={createRestaurantType}>
              <label>
                Type name
                <input name="name" required />
              </label>
              <label>
                Emoji (required)
                <input name="emoji" required />
              </label>
              <button type="submit">Create type</button>
            </form>
          </section>

          <section className={styles.panel}>
            <h2>Add Restaurant</h2>
            <form action={createRestaurant} id="create-restaurant-form">
              <RestaurantFormFields
                cities={data.cities}
                types={data.types}
                keyPrefix="create-restaurant"
                submitLabel="Create restaurant"
                disableSubmit={data.cities.length === 0 || data.types.length === 0}
              />
            </form>
          </section>
        </div>

        <section className={styles.panel}>
          <h2>Current Restaurants</h2>
          <PublicEatsPage
            restaurants={data.restaurants}
            embedded
            title={null}
            adminTools={{ cities: data.cities, types: data.types }}
          />
        </section>
      </main>
    </div>
  );
}
