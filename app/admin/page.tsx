import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import {
  createSubdomainTenant,
  createCity,
  createCountry,
  createRestaurantType,
  getCmsData,
  logoutAdmin,
  updateCurrentTenantSettings,
  updateSubdomainTenant,
  updateCity,
  updateCountry,
  updateRestaurantType
} from '@/app/actions';
import { AdminEntityDeleteForm } from '@/app/components/admin-entity-delete-form';
import { ErrorConfirm } from '@/app/components/error-confirm';
import { ResetColorButton } from '@/app/components/reset-color-button';
import { RestoreRestaurantForm } from '@/app/components/restore-restaurant-form';
import { SuccessConfirm } from '@/app/components/success-confirm';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { decodeFlashMessage, flashCookieNames } from '@/lib/flash-cookies';
import { buildThemeCssVariables, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';
import { resolveRequestHost, resolveTenantFromHost, type ResolvedTenant } from '@/lib/tenant';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const host = resolveRequestHost(headers().get('host'), headers().get('x-forwarded-host'));
  let tenant: ResolvedTenant;
  try {
    tenant = await resolveTenantFromHost(getDb(), host);
  } catch {
    notFound();
  }
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const session = token ? await verifyAdminJwt(token) : null;
  const hasSession = doesSessionMatchTenant(session, tenant);
  if (!hasSession) {
    redirect('/admin/login');
  }

  const db = getDb();
  const data = await getCmsData(tenant.id, { includeDeleted: true });
  const subdomainTenants = tenant.isRoot
    ? await db.query.tenants.findMany({
        where: (table, { and, eq }) => and(eq(table.isRoot, false)),
        orderBy: (table, { asc }) => [asc(table.subdomain)]
      })
    : [];
  const cookieStore = cookies();
  const errorMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.adminError)?.value);
  const successMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.adminSuccess)?.value);
  const rootStyle = buildThemeCssVariables(tenant.primaryColor, tenant.secondaryColor, 'tenant') as CSSProperties;
  return (
    <div className={styles.root} style={rootStyle}>
      <main>
        <header className={styles.hero}>
          <div className={styles.heroTop}>
            <h1>{tenant.displayName} Admin</h1>
            <form action={logoutAdmin}>
              <button type="submit">Log Out</button>
            </form>
          </div>
        </header>
        <ErrorConfirm message={errorMessage} />
        <SuccessConfirm message={successMessage} />

        {!tenant.isRoot ? (
          <section className={styles.panel}>
            <h2>Tenant Settings</h2>
            <form action={updateCurrentTenantSettings}>
              <label>
                Display name
                <input name="displayName" required defaultValue={tenant.displayName} />
              </label>
              <label>
                Username
                <input name="adminUsername" required defaultValue={session?.username ?? ''} />
              </label>
              <label>
                Primary color
                <div className={styles.colorPickerRow}>
                  <input
                    id="current-tenant-primary-color"
                    name="primaryColor"
                    type="color"
                    required
                    defaultValue={tenant.primaryColor}
                  />
                  <ResetColorButton
                    inputId="current-tenant-primary-color"
                    color={DEFAULT_PRIMARY_COLOR}
                  />
                </div>
              </label>
              <label>
                Secondary color
                <div className={styles.colorPickerRow}>
                  <input
                    id="current-tenant-secondary-color"
                    name="secondaryColor"
                    type="color"
                    required
                    defaultValue={tenant.secondaryColor}
                  />
                  <ResetColorButton
                    inputId="current-tenant-secondary-color"
                    color={DEFAULT_SECONDARY_COLOR}
                  />
                </div>
              </label>
              <label>
                New password (leave blank to keep)
                <input name="adminPassword" type="password" />
              </label>
              <div className={styles.manageActions}>
                <button type="submit">Save tenant settings</button>
              </div>
            </form>
          </section>
        ) : null}

        <div className={styles.builderGrid}>
          {tenant.isRoot ? (
            <section className={styles.panel}>
              <h2>Add Subdomain Tenant</h2>
              <form action={createSubdomainTenant} data-reset-on-success="true">
                <label>
                  Subdomain
                  <input name="subdomain" required />
                </label>
                <label>
                  Display name
                  <input name="displayName" required />
                </label>
                <label>
                  Username
                  <input name="adminUsername" required />
                </label>
                <label>
                  Primary color
                  <div className={styles.colorPickerRow}>
                    <input
                      id="create-subdomain-primary-color"
                      name="primaryColor"
                      type="color"
                      required
                      defaultValue={DEFAULT_PRIMARY_COLOR}
                    />
                    <ResetColorButton
                      inputId="create-subdomain-primary-color"
                      color={DEFAULT_PRIMARY_COLOR}
                    />
                  </div>
                </label>
                <label>
                  Secondary color
                  <div className={styles.colorPickerRow}>
                    <input
                      id="create-subdomain-secondary-color"
                      name="secondaryColor"
                      type="color"
                      required
                      defaultValue={DEFAULT_SECONDARY_COLOR}
                    />
                    <ResetColorButton
                      inputId="create-subdomain-secondary-color"
                      color={DEFAULT_SECONDARY_COLOR}
                    />
                  </div>
                </label>
                <label>
                  Password
                  <input name="adminPassword" type="password" required />
                </label>
                <div className={styles.manageActions}>
                  <button type="submit">Create subdomain</button>
                </div>
              </form>
            </section>
          ) : null}

          <section className={styles.panel}>
            <h2>Add Country</h2>
            <form action={createCountry} data-reset-on-success="true">
              <label>
                Country name
                <input name="name" required />
              </label>
              <button type="submit">Create country</button>
            </form>
          </section>

          <section className={styles.panel}>
            <h2>Add City</h2>
            <form action={createCity} data-reset-on-success="true">
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
              <label>
                <input name="isDefault" type="checkbox" />
                Set as default city
              </label>
              <button type="submit" disabled={data.countries.length === 0}>
                Create city
              </button>
            </form>
          </section>

          <section className={styles.panel}>
            <h2>Add Restaurant Type</h2>
            <form action={createRestaurantType} data-reset-on-success="true">
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

        </div>

        {tenant.isRoot ? (
          <section className={styles.panel}>
            <h2>Manage Subdomains</h2>
            {subdomainTenants.length === 0 ? (
              <p>No subdomains yet.</p>
            ) : (
              <div className={styles.manageList}>
                {subdomainTenants.map((subdomainTenant) => (
                  <details key={subdomainTenant.id} className={styles.manageItem}>
                    <summary>
                      {subdomainTenant.subdomain} - {subdomainTenant.displayName}
                    </summary>
                    <form action={updateSubdomainTenant}>
                      <input type="hidden" name="tenantId" value={subdomainTenant.id} />
                      <label>
                        Subdomain
                        <input name="subdomain" required defaultValue={subdomainTenant.subdomain ?? ''} />
                      </label>
                      <label>
                        Display name
                        <input name="displayName" required defaultValue={subdomainTenant.displayName} />
                      </label>
                      <label>
                        Username
                        <input name="adminUsername" required defaultValue={subdomainTenant.adminUsername ?? ''} />
                      </label>
                      <label>
                        Primary color
                        <div className={styles.colorPickerRow}>
                          <input
                            id={`subdomain-${subdomainTenant.id}-primary-color`}
                            name="primaryColor"
                            type="color"
                            required
                            defaultValue={subdomainTenant.primaryColor}
                          />
                          <ResetColorButton
                            inputId={`subdomain-${subdomainTenant.id}-primary-color`}
                            color={DEFAULT_PRIMARY_COLOR}
                          />
                        </div>
                      </label>
                      <label>
                        Secondary color
                        <div className={styles.colorPickerRow}>
                          <input
                            id={`subdomain-${subdomainTenant.id}-secondary-color`}
                            name="secondaryColor"
                            type="color"
                            required
                            defaultValue={subdomainTenant.secondaryColor}
                          />
                          <ResetColorButton
                            inputId={`subdomain-${subdomainTenant.id}-secondary-color`}
                            color={DEFAULT_SECONDARY_COLOR}
                          />
                        </div>
                      </label>
                      <label>
                        New password (leave blank to keep)
                        <input name="adminPassword" type="password" />
                      </label>
                      <div className={styles.manageActions}>
                        <button type="submit">Save subdomain</button>
                      </div>
                    </form>
                  </details>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className={styles.panel}>
          <h2>Deleted Restaurants</h2>
          {data.deletedRestaurants.length === 0 ? (
            <p>No deleted restaurants.</p>
          ) : (
            <div className={styles.manageList}>
              {data.deletedRestaurants.map((restaurant) => (
                <div key={restaurant.id} className={styles.manageItem}>
                  <strong>{restaurant.name}</strong>
                  <div>
                    {restaurant.cityName}, {restaurant.countryName}
                  </div>
                  <RestoreRestaurantForm restaurantId={restaurant.id} restaurantName={restaurant.name} />
                </div>
              ))}
            </div>
          )}
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
                  {city.isDefault ? ' (Default)' : ''}
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
                  <label>
                    <input name="isDefault" type="checkbox" defaultChecked={city.isDefault} />
                    Default city
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
