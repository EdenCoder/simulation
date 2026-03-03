/**
 * Door data structure for saving/loading
 */
export interface SavedDoor {
  x: number;
  y: number;
  type: 'horizontal' | 'vertical';
  position: 'left' | 'right';
  isOpen: boolean;
  isLocked: boolean;
}

/**
 * Region data structure for saving/loading
 */
export interface SavedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: number;
}

/**
 * Build data structure
 */
export interface BuildData {
  doors: SavedDoor[];
  regions: SavedRegion[];
  version: string;
  timestamp: number;
}

/**
 * Save current build to localStorage
 */
export function saveBuild(doors: any[], regions: any[]): void {
  const savedDoors: SavedDoor[] = doors.map(door => ({
    x: door.x,
    y: door.y,
    type: door.getDoorType(),
    position: door.getDoorPosition(),
    isOpen: door.isDoorOpen(),
    isLocked: door.isDoorLocked()
  }));

  const savedRegions: SavedRegion[] = regions.map(region => region.getProperties());

  const buildData: BuildData = {
    doors: savedDoors,
    regions: savedRegions,
    version: '1.1.0',
    timestamp: Date.now()
  };

  try {
    localStorage.setItem('sim-build-data', JSON.stringify(buildData));
  } catch (error) {
    console.error('Failed to save build:', error);
  }
}

/**
 * Load build from data.json
 */
export function loadBuild(): BuildData {
  try {
    // Try to load from data.json synchronously if available
    // For async loading, we'd need to make this async, but for now we'll use a cached version
    const cachedData = (window as any).__buildDataCache;
    if (cachedData) {
      const buildData: BuildData = cachedData;
      // Ensure regions is always an array
      if (!buildData.regions) {
        buildData.regions = [];
      }
      return buildData;
    }

    // Fallback: try to fetch synchronously (this won't work in all cases)
    // For now, return empty data and let async load handle it
    return { doors: [], regions: [], version: '1.1.0', timestamp: 0 };
  } catch (error) {
    console.error('Failed to load build:', error);
    return { doors: [], regions: [], version: '1.1.0', timestamp: 0 };
  }
}

/**
 * Load build data from data.json asynchronously
 */
export async function loadBuildAsync(): Promise<BuildData> {
  try {
    const response = await fetch('/data.json');
    if (!response.ok) {
      console.warn('Failed to fetch data.json, using empty build data');
      return { doors: [], regions: [], version: '1.1.0', timestamp: 0 };
    }
    
    const buildData: BuildData = await response.json();
    
    // Cache the data for synchronous access
    (window as any).__buildDataCache = buildData;
    
    // Ensure regions is always an array
    if (!buildData.regions) {
      buildData.regions = [];
    }
    
    return buildData;
  } catch (error) {
    console.error('Failed to load build from data.json:', error);
    return { doors: [], regions: [], version: '1.1.0', timestamp: 0 };
  }
}

/**
 * Clear all saved build data
 */
export function clearSavedBuild(): void {
  try {
    localStorage.removeItem('sim-build-data');
  } catch (error) {
    console.error('Failed to clear saved build data:', error);
  }
}

/**
 * Check if there is any saved build data
 */
export function hasSavedBuild(): boolean {
  try {
    const savedData = localStorage.getItem('sim-build-data');
    if (!savedData) return false;

    const buildData: BuildData = JSON.parse(savedData);
    const hasDoors = buildData.doors && buildData.doors.length > 0;
    const hasRegions = buildData.regions && buildData.regions.length > 0;
    return hasDoors || hasRegions;
  } catch (error) {
    console.error('Error checking for saved build:', error);
    return false;
  }
}