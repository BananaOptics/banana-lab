export interface Point {
  x: number;
  y: number;
}

/**
 * Compute a 3x3 homography matrix mapping four source points to four destination points.
 * Uses the DLT algorithm, solving the 8x8 system directly.
 *
 * Returns a flat 9-element array representing:
 *   | h0 h1 h2 |
 *   | h3 h4 h5 |
 *   | h6 h7 h8 |
 */
export function computeHomography(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): number[] {
  // Set h8 = 1, then we have 8 equations in 8 unknowns (h0..h7):
  //   sx*h0 + sy*h1 + h2 - dx*sx*h6 - dx*sy*h7 = dx
  //   sx*h3 + sy*h4 + h5 - dy*sx*h6 - dy*sy*h7 = dy
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  const h8 = solve8x8(A, b);
  return [...h8, 1];
}

/**
 * Apply a homography to transform a point.
 */
export function applyHomography(H: number[], p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * Compute the PD in mm between two pupil points, using four card corner
 * points as a reference for a credit card (85.6mm x 53.98mm, ISO 7810 ID-1).
 *
 * Corners should be ordered: top-left, top-right, bottom-right, bottom-left.
 * Result is rounded to the nearest 0.5mm.
 */
export function measurePdMm(
  cardCorners: [Point, Point, Point, Point],
  leftPupil: Point,
  rightPupil: Point,
): number {
  const CARD_W = 85.6;
  const CARD_H = 53.98;

  const dst: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: CARD_W, y: 0 },
    { x: CARD_W, y: CARD_H },
    { x: 0, y: CARD_H },
  ];

  const H = computeHomography(cardCorners, dst);
  const left = applyHomography(H, leftPupil);
  const right = applyHomography(H, rightPupil);

  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const distMm = Math.sqrt(dx * dx + dy * dy);

  return Math.round(distMm * 2) / 2;
}

/** Solve Ax = b for an 8x8 system using Gaussian elimination with partial pivoting. */
function solve8x8(A: number[][], b: number[]): number[] {
  const n = 8;
  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxVal = Math.abs(M[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error("Homography: singular matrix, check card corner positions");
    }

    // Scale pivot row
    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}
