const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const TILE_SIZE = 48; // Standard tile size in pixels
const ITEMS_DIR = path.join(__dirname, '../src/assets/items');
const OUTPUT_FILE = path.join(__dirname, '../src/assets/items/index.ts');

/**
 * Analyzes a PNG file to determine sprite sheet dimensions and frame count
 * @param {string} filePath - Path to the PNG file
 * @returns {Promise<{width: number, height: number, frames: number}>}
 */
async function analyzeImage(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const png = new PNG();
    
    stream.pipe(png).on('parsed', function() {
      const { width: imgWidth, height: imgHeight, data } = this;
      
      // Find the actual content bounds by checking alpha channel
      let minX = imgWidth, maxX = 0, minY = imgHeight, maxY = 0;
      let hasContent = false;
      
      for (let y = 0; y < imgHeight; y++) {
        for (let x = 0; x < imgWidth; x++) {
          const idx = (imgWidth * y + x) << 2;
          const alpha = data[idx + 3];
          
          if (alpha > 0) { // Non-transparent pixel
            hasContent = true;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      
      if (!hasContent) {
        resolve({ width: 1, height: 1, frames: 1 });
        return;
      }
      
      const contentWidth = maxX - minX + 1;
      const contentHeight = maxY - minY + 1;
      
      // Determine the size of a single frame by finding the smallest repeating unit
      // First, find the actual sprite bounds that contain content
      let singleFrameWidth = contentWidth;
      let singleFrameHeight = contentHeight;
      
      // Try to detect repeating patterns by checking for gaps or consistent spacing
      // For horizontal sprite sheets, look for vertical gaps that might separate frames
      const verticalGaps = [];
      for (let x = minX; x <= maxX; x++) {
        let hasContentInColumn = false;
        for (let y = minY; y <= maxY; y++) {
          const idx = (imgWidth * y + x) << 2;
          if (data[idx + 3] > 0) {
            hasContentInColumn = true;
            break;
          }
        }
        if (!hasContentInColumn) {
          verticalGaps.push(x);
        }
      }
      
      // For vertical sprite sheets, look for horizontal gaps
      const horizontalGaps = [];
      for (let y = minY; y <= maxY; y++) {
        let hasContentInRow = false;
        for (let x = minX; x <= maxX; x++) {
          const idx = (imgWidth * y + x) << 2;
          if (data[idx + 3] > 0) {
            hasContentInRow = true;
            break;
          }
        }
        if (!hasContentInRow) {
          horizontalGaps.push(y);
        }
      }
      
      // Determine frame layout and count
      let frames = 1;
      let tilesWidth, tilesHeight;
      
      // Check if this looks like a horizontal sprite sheet
      if (verticalGaps.length > 0) {
        // Find consistent gaps that might separate frames
        const gapSpacing = [];
        for (let i = 1; i < verticalGaps.length; i++) {
          gapSpacing.push(verticalGaps[i] - verticalGaps[i-1]);
        }
        
        // If we have consistent spacing, use it to determine frame width
        if (gapSpacing.length > 0) {
          const avgSpacing = gapSpacing.reduce((a, b) => a + b, 0) / gapSpacing.length;
          const frameWidth = Math.round(avgSpacing);
          if (frameWidth > 0 && frameWidth <= contentWidth) {
            frames = Math.floor(contentWidth / frameWidth) + 1;
            singleFrameWidth = frameWidth;
          }
        }
      }
      
      // Check if this looks like a vertical sprite sheet
      if (frames === 1 && horizontalGaps.length > 0) {
        const gapSpacing = [];
        for (let i = 1; i < horizontalGaps.length; i++) {
          gapSpacing.push(horizontalGaps[i] - horizontalGaps[i-1]);
        }
        
        if (gapSpacing.length > 0) {
          const avgSpacing = gapSpacing.reduce((a, b) => a + b, 0) / gapSpacing.length;
          const frameHeight = Math.round(avgSpacing);
          if (frameHeight > 0 && frameHeight <= contentHeight) {
            frames = Math.floor(contentHeight / frameHeight) + 1;
            singleFrameHeight = frameHeight;
          }
        }
      }
      
      // If no gaps detected, try to detect frames based on image dimensions and tile size
      if (frames === 1) {
        // Check if the image width is a multiple of tile sizes
        const possibleFrameWidths = [];
        for (let tiles = 1; tiles <= 4; tiles++) {
          const frameWidth = tiles * TILE_SIZE;
          if (imgWidth % frameWidth === 0 && imgWidth >= frameWidth) {
            possibleFrameWidths.push({ width: frameWidth, frames: imgWidth / frameWidth, tiles });
          }
        }
        
        // Check if the image height is a multiple of tile sizes
        const possibleFrameHeights = [];
        for (let tiles = 1; tiles <= 4; tiles++) {
          const frameHeight = tiles * TILE_SIZE;
          if (imgHeight % frameHeight === 0 && imgHeight >= frameHeight) {
            possibleFrameHeights.push({ height: frameHeight, frames: imgHeight / frameHeight, tiles });
          }
        }
        
        // Choose the most likely frame configuration
        if (possibleFrameWidths.length > 0 && imgWidth > imgHeight) {
          // Horizontal sprite sheet
          const best = possibleFrameWidths.find(f => f.frames > 1) || possibleFrameWidths[0];
          frames = best.frames;
          singleFrameWidth = best.width;
          tilesWidth = best.tiles;
          tilesHeight = Math.ceil(singleFrameHeight / TILE_SIZE);
        } else if (possibleFrameHeights.length > 0 && imgHeight > imgWidth) {
          // Vertical sprite sheet
          const best = possibleFrameHeights.find(f => f.frames > 1) || possibleFrameHeights[0];
          frames = best.frames;
          singleFrameHeight = best.height;
          tilesHeight = best.tiles;
          tilesWidth = Math.ceil(singleFrameWidth / TILE_SIZE);
        } else {
          // Single frame or square grid
          tilesWidth = Math.ceil(singleFrameWidth / TILE_SIZE);
          tilesHeight = Math.ceil(singleFrameHeight / TILE_SIZE);
          
          // Check for square grid patterns
          if (imgWidth === imgHeight && imgWidth % (tilesWidth * TILE_SIZE) === 0) {
            const gridSize = imgWidth / (tilesWidth * TILE_SIZE);
            if (gridSize > 1) {
              frames = gridSize * gridSize;
            }
          }
        }
      } else {
        // We detected frames via gaps, calculate tile dimensions
        tilesWidth = Math.ceil(singleFrameWidth / TILE_SIZE);
        tilesHeight = Math.ceil(singleFrameHeight / TILE_SIZE);
      }
      
      // Ensure we have valid tile dimensions
      if (!tilesWidth) tilesWidth = Math.ceil(singleFrameWidth / TILE_SIZE);
      if (!tilesHeight) tilesHeight = Math.ceil(singleFrameHeight / TILE_SIZE);
      
      resolve({
        width: tilesWidth,
        height: tilesHeight,
        frames: frames
      });
    }).on('error', reject);
  });
}

/**
 * Converts filename to camelCase variable name
 * @param {string} filename - The filename without extension
 * @returns {string} - camelCase variable name
 */
function toCamelCase(filename) {
  // Remove -loop postfix if present
  const cleanFilename = filename.replace(/-loop$/, '');
  
  return cleanFilename
    .split('-')
    .map((word, index) => {
      if (index === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('');
}

/**
 * Main function to analyze all items and generate the index file
 */
async function analyzeAllItems() {
  console.log('Analyzing items in:', ITEMS_DIR);
  
  const files = fs.readdirSync(ITEMS_DIR)
    .filter(file => file.endsWith('.png'))
    .sort();
  
  console.log(`Found ${files.length} PNG files to analyze...`);
  
  const imports = [];
  const exports = [];
  
  for (const file of files) {
    const filePath = path.join(ITEMS_DIR, file);
    const filename = path.basename(file, '.png');
    const varName = toCamelCase(filename);
    
    console.log(`Analyzing ${file}...`);
    
    try {
      const analysis = await analyzeImage(filePath);
      console.log(`  ${file}: ${analysis.width}x${analysis.height} tiles, ${analysis.frames} frames`);
      
      imports.push(`import ${varName} from './${file}';`);
      exports.push(`  ${varName}: { asset: ${varName}, width: ${analysis.width}, height: ${analysis.height}, frames: ${analysis.frames} },`);
    } catch (error) {
      console.error(`Error analyzing ${file}:`, error.message);
      // Fallback to default values
      imports.push(`import ${varName} from './${file}';`);
      exports.push(`  ${varName}: { asset: ${varName}, width: 1, height: 1, frames: 1 }, // Error analyzing`);
    }
  }
  
  const indexContent = `// Auto-generated file - do not edit manually
// Generated by scripts/analyze-items.js

${imports.join('\n')}

// Export all items with sprite sheet information (width, height in tiles, frame count)
export const items = {
${exports.join('\n')}
} as const;

// Export item keys for easy access
export const itemKeys = Object.keys(items) as Array<keyof typeof items>;

// Export default export for convenience
export default items;

// Type definitions for TypeScript support
export type ItemKey = keyof typeof items;
export type ItemData = {
  asset: string;
  width: number;  // Width in tiles
  height: number; // Height in tiles
  frames: number; // Number of animation frames
};
`;

  fs.writeFileSync(OUTPUT_FILE, indexContent);
  console.log(`\nGenerated ${OUTPUT_FILE}`);
  console.log(`Analyzed ${files.length} items successfully!`);
}

// Run the analysis
analyzeAllItems().catch(console.error);