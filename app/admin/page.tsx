import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import {
  createSubdomainTenant,
  createCity,
  createCountry,
  createRestaurantType,
  deleteSubdomainTenant,
  getCmsData,
  importAdminData,
  loginToSubdomainTenant,
  logoutAdmin,
  updateCurrentTenantSettings,
  updateSubdomainTenant,
  updateCity,
  updateCountry,
  updateRestaurantType
} from '@/app/actions';
import { AdminSubdomainDraftCleanup } from '@/app/components/admin-subdomain-draft-cleanup';
import { AdminEntityDeleteForm } from '@/app/components/admin-entity-delete-form';
import { AdminPanelSection } from '@/app/components/admin-panel-section';
import { ColorField } from '@/app/components/color-field';
import { ConfirmingActionForm } from '@/app/components/confirming-action-form';
import { ErrorConfirm } from '@/app/components/error-confirm';
import { PermanentlyDeleteRestaurantForm } from '@/app/components/permanently-delete-restaurant-form';
import { RestoreRestaurantForm } from '@/app/components/restore-restaurant-form';
import { SuccessConfirm } from '@/app/components/success-confirm';
import { ADMIN_SUBDOMAIN_DRAFT_COOKIE, decodeAdminSubdomainDraft } from '@/lib/admin-form-state';
import { getDb } from '@/lib/db';
import { flashCookieNames } from '@/lib/flash-cookies';
import { getAdminSessionForTenant, readFlashMessages, resolveRequestTenant } from '@/lib/request-context';
import { buildTenantHost, resolvePublicRequestHostWithPort } from '@/lib/tenant';
import { buildThemeCssVariables, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

type AdminTabId = 'settings' | 'subdomains' | 'countries' | 'cities' | 'types' | 'deleted' | 'backup';

type AdminTab = {
  count?: number;
  description: string;
  id: AdminTabId;
  label: string;
};

type AdminPageProps = {
  searchParams?: {
    tab?: string | string[];
  };
};

const getRequestedTab = (searchParams?: AdminPageProps['searchParams']): string | undefined => {
  const requestedTab = searchParams?.tab;
  return Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
};

const getEditableSubdomainValue = (subdomain: string | null | undefined): string =>
  String(subdomain ?? '').replace(/^eats-/, '');

export default async function HomePage({ searchParams }: AdminPageProps) {
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
    const subdomainDraft = decodeAdminSubdomainDraft(cookies().get(ADMIN_SUBDOMAIN_DRAFT_COOKIE)?.value);
    const headerStore = headers();
    const requestHostWithPort = resolvePublicRequestHostWithPort(
      headerStore.get('host'),
      headerStore.get('x-forwarded-host'),
      headerStore.get('origin'),
      headerStore.get('referer')
    );
    const rootStyle = buildThemeCssVariables(tenant.primaryColor, tenant.secondaryColor, 'tenant') as CSSProperties;
    const activeRestaurantCount = data.restaurants.length;
    const deletedRestaurantCount = data.deletedRestaurants.length;
    const cityCount = data.cities.length;
    const typeCount = data.types.length;
    const countryCount = data.countries.length;
    const tabs: AdminTab[] = tenant.isRoot
      ? [
          {
            description: 'Update the root tenant display name and theme colours.',
            id: 'settings',
            label: 'Settings'
          },
          {
            count: subdomainTenants.length,
            description: 'Create and manage separate tenant spaces for other people.',
            id: 'subdomains',
            label: 'Subdomains'
          },
          {
            count: countryCount,
            description: 'Add countries and rename or remove ones that are no longer needed.',
            id: 'countries',
            label: 'Countries'
          },
          {
            count: cityCount,
            description: 'Add cities, move them between countries, and choose the default city.',
            id: 'cities',
            label: 'Cities'
          },
          {
            count: typeCount,
            description: 'Maintain restaurant types and their required emoji labels.',
            id: 'types',
            label: 'Restaurant Types'
          },
          {
            count: deletedRestaurantCount,
            description: 'Restore deleted restaurants or remove them permanently.',
            id: 'deleted',
            label: 'Deleted Restaurants'
          },
          {
            description: 'Export JSON backups and replace data by importing a previous export.',
            id: 'backup',
            label: 'Backup & Restore'
          }
        ]
      : [
          {
            description: 'Update your display name, login credentials, and theme colours.',
            id: 'settings',
            label: 'Settings'
          },
          {
            count: countryCount,
            description: 'Add countries and rename or remove ones that are no longer needed.',
            id: 'countries',
            label: 'Countries'
          },
          {
            count: cityCount,
            description: 'Add cities, move them between countries, and choose the default city.',
            id: 'cities',
            label: 'Cities'
          },
          {
            count: typeCount,
            description: 'Maintain restaurant types and their required emoji labels.',
            id: 'types',
            label: 'Restaurant Types'
          },
          {
            count: deletedRestaurantCount,
            description: 'Restore deleted restaurants or remove them permanently.',
            id: 'deleted',
            label: 'Deleted Restaurants'
          },
          {
            description: 'Export your tenant as JSON or replace it from a previous export.',
            id: 'backup',
            label: 'Backup & Restore'
          }
        ];
    const requestedTab = getRequestedTab(searchParams);
    const activeTab = tabs.some((tab) => tab.id === requestedTab)
      ? (requestedTab as AdminTabId)
      : tabs[0].id;
    const activeTabConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

    const renderActiveTab = () => {
      if (activeTab === 'settings') {
        return (
          <div className={styles.resourceGridSingle}>
            <AdminPanelSection className={styles.panel} title="Settings">
              <form action={updateCurrentTenantSettings}>
                <label>
                  Display name
                  <input name="displayName" required defaultValue={tenant.displayName} />
                </label>
                {tenant.isRoot ? null : (
                  <label>
                    Username
                    <input name="adminUsername" required defaultValue={session.username} />
                  </label>
                )}
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
                {tenant.isRoot ? null : (
                  <label>
                    New password (leave blank to keep)
                    <input name="adminPassword" type="password" />
                  </label>
                )}
                <div className={styles.manageActions}>
                  <button type="submit">Save settings</button>
                </div>
              </form>
            </AdminPanelSection>
          </div>
        );
      }

      if (activeTab === 'subdomains') {
        return (
          <div className={styles.resourceGrid}>
            <AdminPanelSection className={styles.panel} title="Create Subdomain">
              <form action={createSubdomainTenant} data-reset-on-success="true">
                <label>
                  Subdomain
                  <div className={styles.subdomainField}>
                    <span className={styles.subdomainPrefix}>eats-</span>
                    <input
                      name="subdomain"
                      required
                      defaultValue={getEditableSubdomainValue(subdomainDraft?.subdomain)}
                      placeholder="your-name"
                    />
                  </div>
                </label>
                <label>
                  Display name
                  <input name="displayName" required defaultValue={subdomainDraft?.displayName ?? ''} />
                </label>
                <label>
                  Username
                  <input name="adminUsername" required defaultValue={subdomainDraft?.adminUsername ?? ''} />
                </label>
                <ColorField
                  label="Primary color"
                  inputId="create-subdomain-primary-color"
                  name="primaryColor"
                  defaultValue={subdomainDraft?.primaryColor || DEFAULT_PRIMARY_COLOR}
                  resetColor={DEFAULT_PRIMARY_COLOR}
                  rowClassName={styles.colorPickerRow}
                />
                <ColorField
                  label="Secondary color"
                  inputId="create-subdomain-secondary-color"
                  name="secondaryColor"
                  defaultValue={subdomainDraft?.secondaryColor || DEFAULT_SECONDARY_COLOR}
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

            <AdminPanelSection className={styles.panel} title="Existing Subdomains">
              {subdomainTenants.length === 0 ? (
                <p className={styles.emptyState}>No subdomains yet.</p>
              ) : (
                <div className={styles.manageList}>
                  {subdomainTenants.map((subdomainTenant) => (
                    <details key={subdomainTenant.id} className={styles.manageItem}>
                      <summary>
                        {subdomainTenant.subdomain} - {subdomainTenant.displayName}
                      </summary>
                      <form id={`subdomain-form-${subdomainTenant.id}`} action={updateSubdomainTenant}>
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
                      </form>
                      <div className={styles.manageActions}>
                        <a
                          className={styles.exportLink}
                          href={`//${buildTenantHost(requestHostWithPort, subdomainTenant.subdomain)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View tenant
                        </a>
                        <button
                          type="submit"
                          form={`subdomain-form-${subdomainTenant.id}`}
                          formAction={loginToSubdomainTenant}
                        >
                          Log into tenant
                        </button>
                        <button type="submit" form={`subdomain-form-${subdomainTenant.id}`}>
                          Save subdomain
                        </button>
                        <ConfirmingActionForm
                          action={deleteSubdomainTenant}
                          confirmText={`Delete tenant "${subdomainTenant.displayName}" and all of its records? This cannot be undone.`}
                          promptValue={subdomainTenant.subdomain ?? ''}
                          promptLabel={`Type ${subdomainTenant.subdomain} to delete this tenant`}
                        >
                          <input type="hidden" name="tenantId" value={subdomainTenant.id} />
                          <button data-delete-button="true" type="submit">
                            Delete tenant
                          </button>
                        </ConfirmingActionForm>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </AdminPanelSection>
          </div>
        );
      }

      if (activeTab === 'countries') {
        return (
          <div className={styles.resourceGrid}>
            <AdminPanelSection className={styles.panel} title="Add Country">
              <form action={createCountry} data-reset-on-success="true">
                <label>
                  Country name
                  <input name="name" required />
                </label>
                <div className={styles.manageActions}>
                  <button type="submit">Create country</button>
                </div>
              </form>
            </AdminPanelSection>

            <AdminPanelSection className={styles.panel} title="Existing Countries">
              {data.countries.length === 0 ? (
                <p className={styles.emptyState}>No countries yet.</p>
              ) : (
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
              )}
            </AdminPanelSection>
          </div>
        );
      }

      if (activeTab === 'cities') {
        return (
          <div className={styles.resourceGrid}>
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
                <div className={styles.manageActions}>
                  <button type="submit" disabled={data.countries.length === 0}>
                    Create city
                  </button>
                </div>
              </form>
            </AdminPanelSection>

            <AdminPanelSection className={styles.panel} title="Existing Cities">
              {data.cities.length === 0 ? (
                <p className={styles.emptyState}>No cities yet.</p>
              ) : (
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
              )}
            </AdminPanelSection>
          </div>
        );
      }

      if (activeTab === 'types') {
        return (
          <div className={styles.resourceGrid}>
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
                <div className={styles.manageActions}>
                  <button type="submit">Create type</button>
                </div>
              </form>
            </AdminPanelSection>

            <AdminPanelSection className={styles.panel} title="Existing Restaurant Types">
              {data.types.length === 0 ? (
                <p className={styles.emptyState}>No restaurant types yet.</p>
              ) : (
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
              )}
            </AdminPanelSection>
          </div>
        );
      }

      if (activeTab === 'backup') {
        return (
          <div className={styles.resourceGrid}>
            <AdminPanelSection className={styles.panel} title="Export Data">
              <div className={styles.exportActions}>
                <a className={styles.exportLink} href="/admin/export">
                  {tenant.isRoot ? 'Export current tenant JSON' : 'Export tenant JSON'}
                </a>
                {tenant.isRoot ? (
                  <a className={styles.exportLink} href="/admin/export?scope=all">
                    Export all tenants JSON
                  </a>
                ) : null}
              </div>
            </AdminPanelSection>

            <AdminPanelSection className={styles.panel} title="Import Data">
              <ConfirmingActionForm
                action={importAdminData}
                confirmText={
                  tenant.isRoot
                    ? 'Import this backup? This replaces the current root tenant data, or all tenants if the file is an all-tenants export.'
                    : 'Import this backup? This replaces your current tenant data.'
                }
              >
                <label>
                  JSON export file
                  <input accept="application/json,.json" name="importFile" required type="file" />
                </label>
                <p className={styles.importHint}>
                  {tenant.isRoot
                    ? 'Imports replace existing data instead of merging. Root imports can restore either root-only exports or all-tenant exports.'
                    : 'Imports replace existing data instead of merging.'}
                </p>
                <div className={styles.manageActions}>
                  <button type="submit">Import JSON</button>
                </div>
              </ConfirmingActionForm>
            </AdminPanelSection>
          </div>
        );
      }

      return (
        <div className={styles.resourceGridSingle}>
          <AdminPanelSection className={styles.panel} title="Deleted Restaurants">
            {data.deletedRestaurants.length === 0 ? (
              <p className={styles.emptyState}>No deleted restaurants.</p>
            ) : (
              <div className={styles.manageList}>
                {data.deletedRestaurants.map((restaurant) => (
                  <div key={restaurant.id} className={styles.manageItem}>
                    <strong>{restaurant.name}</strong>
                    <div>
                      {restaurant.cityName}, {restaurant.countryName}
                    </div>
                    <div className={`${styles.manageActions} ${styles.deletedActions}`}>
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
        </div>
      );
    };

    return (
      <div className={styles.root} style={rootStyle}>
        <main>
          <header className={styles.hero}>
            <div className={styles.heroTop}>
              <div className={styles.heroCopy}>
                <h1>Admin Panel</h1>
              </div>
              <div className={styles.heroActions}>
                <Link href="/">View Site</Link>
                <form action={logoutAdmin}>
                  <button type="submit">Log Out</button>
                </form>
              </div>
            </div>
            <div className={styles.heroStats}>
              <div className={styles.heroStat}>
                <span className={styles.heroStatValue}>{activeRestaurantCount}</span>
                <span className={styles.heroStatLabel}>Active Restaurants</span>
              </div>
              <div className={styles.heroStat}>
                <span className={styles.heroStatValue}>{countryCount}</span>
                <span className={styles.heroStatLabel}>Countries</span>
              </div>
              <div className={styles.heroStat}>
                <span className={styles.heroStatValue}>{cityCount}</span>
                <span className={styles.heroStatLabel}>Cities</span>
              </div>
              <div className={styles.heroStat}>
                <span className={styles.heroStatValue}>{typeCount}</span>
                <span className={styles.heroStatLabel}>Restaurant Types</span>
              </div>
            </div>
          </header>

          <ErrorConfirm message={flashMessages[flashCookieNames.adminError]} />
          <SuccessConfirm message={flashMessages[flashCookieNames.adminSuccess]} />
          <AdminSubdomainDraftCleanup enabled={Boolean(subdomainDraft)} />

          <section className={styles.tabsShell}>
            <div className={styles.tabsIntro}>
              <h2>{activeTabConfig.label}</h2>
              <p className={styles.tabsBlurb}>{activeTabConfig.description}</p>
            </div>
            <nav className={styles.tabsList} aria-label="Admin resources">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={`/admin?tab=${tab.id}`}
                  className={`${styles.tabLink} ${activeTab === tab.id ? styles.tabLinkActive : ''}`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  scroll={false}
                >
                  <span>{tab.label}</span>
                  {typeof tab.count === 'number' ? (
                    <span className={styles.tabCount}>{tab.count}</span>
                  ) : null}
                </Link>
              ))}
            </nav>
          </section>

          <section key={activeTab} className={styles.tabContent}>
            {renderActiveTab()}
          </section>
        </main>
      </div>
    );
  } catch {
    notFound();
  }
}
