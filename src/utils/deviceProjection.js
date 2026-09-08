/** Four-corner inverse homography; pixels are projected, not CSS-transformed. */
export function screenMaskFromAlpha({ pixels, width, height }) {
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 2048)
        || width * height > 3_000_000 || !(pixels instanceof Uint8ClampedArray)
        || pixels.length !== width * height * 4) throw new Error('Invalid frame mask input');
    const count = width * height;
    const seed = Math.floor(height / 2) * width + Math.floor(width / 2);
    if (pixels[seed * 4 + 3] !== 0) throw new Error('Missing transparent screen opening');
    const queue = new Uint32Array(count);
    const visited = new Uint8Array(count);
    const mask = new Uint8ClampedArray(count * 4);
    let head = 0, tail = 1;
    let left = width, right = 0, top = height, bottom = 0;
    queue[0] = seed; visited[seed] = 1;
    const add = index => {
        if (!visited[index] && pixels[index * 4 + 3] < 255) {
            visited[index] = 1; queue[tail++] = index;
        }
    };
    while (head < tail) {
        const index = queue[head++], x = index % width, y = Math.floor(index / width);
        // Never treat the outside transparency as the screen. Damaged/open
        // shells fail instead of leaking user pixels outside the device.
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) throw new Error('Unclosed screen opening');
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        mask[index * 4 + 3] = 255;
        add(index - 1); add(index + 1); add(index - width); add(index + width);
    }
    return { pixels: mask, bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } };
}

export function inverseHomography(corners) {
    if (!Array.isArray(corners) || corners.length !== 4
        || corners.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
        throw new Error('Invalid screen corners');
    }
    const targets = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const rows = corners.flatMap(([x, y], index) => {
        const [u, v] = targets[index];
        return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u],
            [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
    });
    for (let column = 0; column < 8; column++) {
        let pivot = column;
        for (let row = column + 1; row < 8; row++) {
            if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        }
        if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error('Degenerate screen corners');
        [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
        const scale = rows[column][column];
        for (let index = column; index <= 8; index++) rows[column][index] /= scale;
        for (let row = 0; row < 8; row++) {
            if (row === column) continue;
            const factor = rows[row][column];
            for (let index = column; index <= 8; index++) rows[row][index] -= factor * rows[column][index];
        }
    }
    return rows.map(row => row[8]);
}

export function mapPoint(matrix, x, y) {
    const denominator = matrix[6] * x + matrix[7] * y + 1;
    return [(matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
        (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator];
}

export function fitRect(sourceWidth, sourceHeight, width, height, mode) {
    if (![sourceWidth, sourceHeight, width, height].every(value => Number.isFinite(value) && value > 0)
        || !['cover', 'contain'].includes(mode)) throw new Error('Invalid image fit');
    const scale = Math[mode === 'cover' ? 'max' : 'min'](width / sourceWidth, height / sourceHeight);
    const drawnWidth = sourceWidth * scale;
    const drawnHeight = sourceHeight * scale;
    return { x: (width - drawnWidth) / 2, y: (height - drawnHeight) / 2, width: drawnWidth, height: drawnHeight };
}

export function warpImage({ pixels, width, height, outputWidth, outputHeight, corners }) {
    if (![width, height, outputWidth, outputHeight].every(value => Number.isInteger(value) && value > 0 && value <= 2048)
        || outputWidth * outputHeight > 3_000_000 || width * height > 3_000_000
        || !(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) {
        throw new Error('Projection budget or pixel buffer invalid');
    }
    const matrix = inverseHomography(corners);
    const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    const left = Math.max(0, Math.floor(Math.min(...corners.map(point => point[0]))) - 2);
    const right = Math.min(outputWidth, Math.ceil(Math.max(...corners.map(point => point[0]))) + 2);
    const top = Math.max(0, Math.floor(Math.min(...corners.map(point => point[1]))) - 2);
    const bottom = Math.min(outputHeight, Math.ceil(Math.max(...corners.map(point => point[1]))) + 2);
    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const [u, v] = mapPoint(matrix, x + 0.5, y + 0.5);
            // Padding covers PSD edge antialiasing; the original alpha mask
            // supplies the final exact screen opening on the main canvas.
            if (!Number.isFinite(u + v) || u < -0.005 || u > 1.005 || v < -0.005 || v > 1.005) continue;
            const sourceX = Math.max(0, Math.min(width - 1, u * width - 0.5));
            const sourceY = Math.max(0, Math.min(height - 1, v * height - 0.5));
            const x0 = Math.floor(sourceX), y0 = Math.floor(sourceY);
            const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
            const fractionX = sourceX - x0, fractionY = sourceY - y0;
            const destination = (y * outputWidth + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                const upper = pixels[(y0 * width + x0) * 4 + channel] * (1 - fractionX)
                    + pixels[(y0 * width + x1) * 4 + channel] * fractionX;
                const lower = pixels[(y1 * width + x0) * 4 + channel] * (1 - fractionX)
                    + pixels[(y1 * width + x1) * 4 + channel] * fractionX;
                output[destination + channel] = upper * (1 - fractionY) + lower * fractionY;
            }
        }
    }
    return output;
}
