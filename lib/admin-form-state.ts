export const ADMIN_SUBDOMAIN_DRAFT_COOKIE = 'admin_subdomain_draft';

export type AdminSubdomainDraft = {
  adminUsername: string;
  displayName: string;
  primaryColor: string;
  secondaryColor: string;
  subdomain: string;
};

export const buildAdminSubdomainDraft = (formData: FormData): AdminSubdomainDraft => ({
  adminUsername: String(formData.get('adminUsername') ?? '').trim(),
  displayName: String(formData.get('displayName') ?? '').trim(),
  primaryColor: String(formData.get('primaryColor') ?? '').trim(),
  secondaryColor: String(formData.get('secondaryColor') ?? '').trim(),
  subdomain: String(formData.get('subdomain') ?? '').trim()
});

export const encodeAdminSubdomainDraft = (draft: AdminSubdomainDraft): string => JSON.stringify(draft);

export const decodeAdminSubdomainDraft = (value: string | null | undefined): AdminSubdomainDraft | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.subdomain !== 'string' ||
      typeof parsed.displayName !== 'string' ||
      typeof parsed.adminUsername !== 'string' ||
      typeof parsed.primaryColor !== 'string' ||
      typeof parsed.secondaryColor !== 'string'
    ) {
      return null;
    }

    return {
      adminUsername: parsed.adminUsername,
      displayName: parsed.displayName,
      primaryColor: parsed.primaryColor,
      secondaryColor: parsed.secondaryColor,
      subdomain: parsed.subdomain
    };
  } catch {
    return null;
  }
};

export const clearAdminSubdomainDraftClient = (): void => {
  document.cookie = `${ADMIN_SUBDOMAIN_DRAFT_COOKIE}=; Max-Age=0; path=/admin; SameSite=Lax`;
};
