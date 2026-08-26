import { MapPin, Loader2 } from "lucide-react";

interface LocationBannerProps {
  gpsReady: boolean;
  gpsGranted: boolean;
  locationInfo: { wardName?: string } | null;
  isSearchMode: boolean;
  refreshingLocation: boolean;
  onRefresh: () => void;
  onSetArea: () => void;
  locationErrorMsg?: string | null;
  hideRefreshButton?: boolean; // ADD THIS
}

export function LocationBanner({
  gpsReady,
  gpsGranted,
  locationInfo,
  isSearchMode,
  refreshingLocation,
  onRefresh,
  onSetArea,
  locationErrorMsg,
  hideRefreshButton = false, // ADD THIS
}: LocationBannerProps) {
  function bannerText() {
    if (isSearchMode) return "Searching across Kenya";
    if (!locationInfo) return "Set your area to see nearby adverts";
    const area = locationInfo.wardName;
    if (area) return `${area} area`;
    return "Set your area to see nearby adverts";
  }

  if (!gpsReady) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
      <MapPin
        size={12}
        className={
          gpsGranted
            ? "text-secondary flex-shrink-0"
            : "text-amber-500 flex-shrink-0"
        }
      />
      <p className="text-xs text-muted-foreground flex-1 truncate">
        {bannerText()}
      </p>
      {!hideRefreshButton && ( // WRAP THE BUTTON WITH THIS CONDITION
        <button
          type="button"
          onClick={locationInfo ? onRefresh : onSetArea}
          disabled={refreshingLocation}
          className="text-xs font-semibold text-primary flex-shrink-0 disabled:opacity-50"
        >
          {refreshingLocation
            ? "Updating..."
            : !locationInfo
            ? "Set area"
            : "Refresh"}
        </button>
      )}
    </div>
  );
}
