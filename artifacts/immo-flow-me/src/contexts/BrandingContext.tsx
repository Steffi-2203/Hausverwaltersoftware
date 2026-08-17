import { createContext, useContext, useMemo } from 'react';
import { useOrganization } from '@/hooks/useOrganization';

interface BrandingConfig {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string;
  isLoading: boolean;
}

const DEFAULT_BRANDING: BrandingConfig = {
  brandName: 'ImmoFlowMe',
  logoUrl: null,
  primaryColor: '#1e40af',
  supportEmail: 'kontakt@immoflowme.at',
  isLoading: false,
};

const BrandingContext = createContext<BrandingConfig>(DEFAULT_BRANDING);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data: organization, isLoading } = useOrganization();

  const branding = useMemo<BrandingConfig>(() => {
    if (isLoading) {
      return { ...DEFAULT_BRANDING, isLoading: true };
    }

    return {
      brandName: (organization as any)?.brandName || (organization as any)?.brand_name || DEFAULT_BRANDING.brandName,
      logoUrl: (organization as any)?.logoUrl || (organization as any)?.logo_url || DEFAULT_BRANDING.logoUrl,
      primaryColor: (organization as any)?.primaryColor || (organization as any)?.primary_color || DEFAULT_BRANDING.primaryColor,
      supportEmail: (organization as any)?.supportEmail || (organization as any)?.support_email || DEFAULT_BRANDING.supportEmail,
      isLoading: false,
    };
  }, [organization, isLoading]);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}

export { DEFAULT_BRANDING };
