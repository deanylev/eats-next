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
import { AdminPanelSection } from '@/app/components/admin-panel-section';
import { AdminEntityDeleteForm } from '@/app/components/admin-entity-delete-form';
import { ColorField } from '@/app/components/color-field';
import { ErrorConfirm } from '@/app/components/error-confirm';
import { PermanentlyDeleteRestaurantForm } from '@/app/components/permanently-delete-restaurant-form';
import { RestoreRestaurantForm } from '@/app/components/restore-restaurant-form';
import { SuccessConfirm } from '@/app/components/success-confirm';
import { getDb } from '@/lib/db';
import { flashCookieNames } from '@/lib/flash-cookies';
import { getAdminSessionForTenant, readFlashMessages, resolveRequestTenant } from '@/lib/request-context';
import { buildThemeCssVariables, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  try {
    const tenant = await resolveRequestTenant();
    const { hasSession, session } = await getAdminSessionForTenant(tenant);
    if (!hasSession || !session) {
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
    const flashMessages = readFlashMessages([
      flashCookieNames.adminError,
      flashCookieNames.adminSuccess
    ] as const);
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
          <ErrorConfirm message={flashMessages[flashCookieNames.adminError]} />
          <SuccessConfirm message={flashMessages[flashCookieNames.adminSuccess]} />

          {!tenant.isRoot ? (
            <AdminPanelSection className={styles.panel} title="Tenant Settings">
              <form action={updateCurrentTenantSettings}>
                <label>
                  Display name
                  <input name="displayName" required defaultValue={tenant.displayName} />
                </label>
                <label>
                  Username
                  <input name="adminUsername" required defaultValue={session.username} />
                </label>
                <ColorField
                  label="Primary color"
                  inputId="current-tenant-primary-color"
                  name="primaryColor"
                  defaultValue={tenant.primaryColor}
                  resetColor={DEFAULT_PRIMARY_COLOR}
                  rowClassName={styles.colorPickerRow}
                />
                <ColorField
                  label="Secondary color"
                  inputId="current-tenant-secondary-color"
                  name="secondaryColor"
                  defaultValue={tenant.secondaryColor}
                  resetColor={DEFAULT_SECONDARY_COLOR}
                  rowClassName={styles.colorPickerRow}
                />
                <label>
                  New password (leave blank to keep)
                  <input name="adminPassword" type="password" />
                </label>
                <div className={styles.manageActions}>
                  <button type="submit">Save tenant settings</button>
                </div>
              </form>
            </AdminPanelSection>
          ) : null}

          <div className={styles.builderGrid}>
            {tenant.isRoot ? (
              <AdminPanelSection className={styles.panel} title="Add Subdomain Tenant">
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
                  <ColorField
                    label="Primary color"
                    inputId="create-subdomain-primary-color"
                    name="primaryColor"
                    defaultValue={DEFAULT_PRIMARY_COLOR}
                    resetColor={DEFAULT_PRIMARY_COLOR}
                    rowClassName={styles.colorPickerRow}
                  />
                  <ColorField
                    label="Secondary color"
                    inputId="create-subdomain-secondary-color"
                    name="secondaryColor"
                    defaultValue={DEFAULT_SECONDARY_COLOR}
                    resetColor={DEFAULT_SECONDARY_COLOR}
                    rowClassName={styles.colorPickerRow}
                  />
                  <label>
                    Password
                    <input name="adminPassword" type="password" required />
                  </label>
                  <div className={styles.manageActions}>
                    <button type="submit">Create subdomain</button>
                  </div>
                </form>
              </AdminPanelSection>
            ) : null}

            <AdminPanelSection className={styles.panel} title="Add Country">
              <form action={createCountry} data-reset-on-success="true">
                <label>
                  Country name
                  <input name="name" required />
                </label>
                <button type="submit">Create country</button>
              </form>
            </AdminPanelSection>

            <AdminPanelSection className={styles.panel} title="Add City">
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
            </AdminPanelSection>

            <AdminPanelSection className={styles.panel} title="Add Restaurant Type">
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
            </AdminPanelSection>
          </div>

          {tenant.isRoot ? (
            <AdminPanelSection className={styles.panel} title="Manage Subdomains">
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
                        <ColorField
                          label="Primary color"
                          inputId={`subdomain-${subdomainTenant.id}-primary-color`}
                          name="primaryColor"
                          defaultValue={subdomainTenant.primaryColor}
                          resetColor={DEFAULT_PRIMARY_COLOR}
                          rowClassName={styles.colorPickerRow}
                        />
                        <ColorField
                          label="Secondary color"
                          inputId={`subdomain-${subdomainTenant.id}-secondary-color`}
                          name="secondaryColor"
                          defaultValue={subdomainTenant.secondaryColor}
                          resetColor={DEFAULT_SECONDARY_COLOR}
                          rowClassName={styles.colorPickerRow}
                        />
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
            </AdminPanelSection>
          ) : null}

          <AdminPanelSection className={styles.panel} title="Deleted Restaurants">
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
                    <div className={styles.manageActions}>
                      <RestoreRestaurantForm restaurantId={restaurant.id} restaurantName={restaurant.name} />
                      <PermanentlyDeleteRestaurantForm
                        restaurantId={restaurant.id}
                        restaurantName={restaurant.name}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AdminPanelSection>

          <AdminPanelSection className={styles.panel} title="Manage Countries">
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
          </AdminPanelSection>

          <AdminPanelSection className={styles.panel} title="Manage Cities">
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
          </AdminPanelSection>

          <AdminPanelSection className={styles.panel} title="Manage Restaurant Types">
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
          </AdminPanelSection>
        </main>
      </div>
    );
  } catch {
    notFound();
  }
}
