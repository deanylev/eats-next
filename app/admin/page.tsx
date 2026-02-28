import { cookies } from 'next/headers';
import {
  createCity,
  createCountry,
  createRestaurant,
  createRestaurantType,
  getCmsData,
  updateCity,
  updateCountry,
  updateRestaurantType
} from '@/app/actions';
import { AdminEntityDeleteForm } from '@/app/components/admin-entity-delete-form';
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

        <section className={styles.panel}>
          <h2>Manage Countries</h2>
          <div className={styles.manageList}>
            {data.countries.map((country) => (
              <details key={country.id} className={styles.manageItem}>
                <summary>{country.name}</summary>
                <form action={updateCountry}>
                  <input type="hidden" name="countryId" value={country.id} />
                  <label>
                    Country name
                    <input name="name" required defaultValue={country.name} />
                  </label>
                  <div className={styles.manageActions}>
                    <button type="submit">Save country</button>
                  </div>
                </form>
                <AdminEntityDeleteForm
                  entityType="country"
                  entityId={country.id}
                  entityName={country.name}
                  buttonLabel="Delete country"
                />
              </details>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <h2>Manage Cities</h2>
          <div className={styles.manageList}>
            {data.cities.map((city) => (
              <details key={city.id} className={styles.manageItem}>
                <summary>
                  {city.name}, {city.countryName}
                </summary>
                <form action={updateCity}>
                  <input type="hidden" name="cityId" value={city.id} />
                  <label>
                    City name
                    <input name="name" required defaultValue={city.name} />
                  </label>
                  <label>
                    Country
                    <select name="countryId" required defaultValue={city.countryId}>
                      {data.countries.map((country) => (
                        <option key={`${city.id}-${country.id}`} value={country.id}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.manageActions}>
                    <button type="submit">Save city</button>
                  </div>
                </form>
                <AdminEntityDeleteForm
                  entityType="city"
                  entityId={city.id}
                  entityName={`${city.name}, ${city.countryName}`}
                  buttonLabel="Delete city"
                />
              </details>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <h2>Manage Restaurant Types</h2>
          <div className={styles.manageList}>
            {data.types.map((type) => (
              <details key={type.id} className={styles.manageItem}>
                <summary>
                  {type.emoji} {type.name}
                </summary>
                <form action={updateRestaurantType}>
                  <input type="hidden" name="typeId" value={type.id} />
                  <label>
                    Type name
                    <input name="name" required defaultValue={type.name} />
                  </label>
                  <label>
                    Emoji
                    <input name="emoji" required defaultValue={type.emoji} />
                  </label>
                  <div className={styles.manageActions}>
                    <button type="submit">Save type</button>
                  </div>
                </form>
                <AdminEntityDeleteForm
                  entityType="type"
                  entityId={type.id}
                  entityName={`${type.emoji} ${type.name}`}
                  buttonLabel="Delete type"
                />
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
