import {PartSegmentation, PersonSegmentation, Pose} from '../types';

declare type Pair = {
  x: number,
  y: number,
};

const NUM_KPT_TO_USE = 5;

function computeDistance(embedding: Pair[], pose: Pose, minPartScore = 0.3) {
  let distance = 0.0;
  let numKpt = 0;
  for (let p = 0; p < NUM_KPT_TO_USE; p++) {
    if (pose.keypoints[p].score > minPartScore) {
      numKpt += 1;
      distance += (embedding[p].x - pose.keypoints[p].position.x) ** 2 +
          (embedding[p].y - pose.keypoints[p].position.y) ** 2;
    }
    pose.keypoints
  }
  if (numKpt === 0) {
    distance = Infinity;
  } else {
    distance = distance / numKpt;
  }
  return distance;
}

export function decodeMultipleMasks(
    segmentation: Uint8Array, longOffsets: Float32Array, poses: Pose[],
    height: number, width: number, stride: number, inputResolution: number,
    [[padT, padB], [padL, padR]]: [[number, number], [number, number]],
    minPoseScore = 0.2, refineSteps = 1 /*8*/, flipHorizontally = false,
    longOffsetsResized = false): PersonSegmentation[] {
  let numPeopleToDecode = 0;
  let posesAboveScores: Pose[] = [];
  for (let k = 0; k < poses.length; k++) {
    if (poses[k].score > minPoseScore) {
      numPeopleToDecode += 1;
      posesAboveScores.push(poses[k]);
    }
  }
  let allPersonSegmentation: PersonSegmentation[] = [];
  for (let k = 0; k < numPeopleToDecode; k++) {
    allPersonSegmentation.push({
      height: height,
      width: width,
      data: new Uint8Array(height * width).fill(0),
      pose: posesAboveScores[k]
    });
  }

  const scale = inputResolution / (padT + padB + height);
  const outputResolution = Math.round((inputResolution - 1.0) / stride + 1.0);
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const n = i * width + j;
      const prob = segmentation[n];
      if (prob === 1) {
        // 1) finds the pixel's embedding vector for all keypoints
        // 2) loops over the poses and find the instnace k that is close to
        // the embedding at the pixel and assign k to the pixel (i, j).
        let embed = [];
        for (let p = 0; p < NUM_KPT_TO_USE; p++) {
          let nn = 0;
          if (longOffsetsResized) {
            nn = i * width + j;
          } else {
            const yResized =
                Math.round(((padT + i + 1.0) * scale - 1.0) / stride);
            const xResized =
                Math.round(((padL + j + 1.0) * scale - 1.0) / stride);
            nn = yResized * outputResolution + xResized;
          }
          let dy = longOffsets[17 * (2 * nn) + p];
          let dx = longOffsets[17 * (2 * nn + 1) + p];
          let y = i + dy;
          let x = j + dx;
          for (let t = 0; t < refineSteps; t++) {
            y = Math.min(Math.round(y), height - 1);
            x = Math.min(Math.round(x), width - 1);
            let nn = 0;
            if (longOffsetsResized) {
              nn = y * width + x;
            } else {
              const yResized =
                  Math.round(((padT + y + 1.0) * scale - 1.0) / stride);
              const xResized =
                  Math.round(((padL + x + 1.0) * scale - 1.0) / stride);
              nn = yResized * outputResolution + xResized;
            }
            dy = longOffsets[17 * (2 * nn) + p];
            dx = longOffsets[17 * (2 * nn + 1) + p];
            y = y + dy;
            x = x + dx;
          }
          embed.push({y: y, x: x});
        }

        let kMin = -1;
        let kMinDist = Infinity;
        for (let k = 0; k < posesAboveScores.length; k++) {
          if (posesAboveScores[k].score > minPoseScore) {
            const dist = computeDistance(embed, posesAboveScores[k]);
            if (dist < kMinDist) {
              kMin = k;
              kMinDist = dist;
            }
          }
        }
        if (kMin >= 0) {
          allPersonSegmentation[kMin].data[n] = 1;
        }
      }
    }
  }
  return allPersonSegmentation
}

export function decodeMultiplePartMasks(
    segmentation: Uint8Array, longOffsets: Float32Array,
    partSegmentaion: Uint8Array, poses: Pose[], height: number, width: number,
    stride: number, inputResolution: number,
    [[padT, padB], [padL, padR]]: [[number, number], [number, number]],
    minPoseScore = 0.2, refineSteps = 1 /*8*/, flipHorizontally = false,
    longOffsetsResized = false): PartSegmentation[] {
  let numPeopleToDecode = 0;
  let posesAboveScores: Pose[] = [];
  for (let k = 0; k < poses.length; k++) {
    if (poses[k].score > minPoseScore) {
      numPeopleToDecode += 1;
      posesAboveScores.push(poses[k]);
    }
  }
  let allPersonSegmentation: PartSegmentation[] = [];
  for (let k = 0; k < numPeopleToDecode; k++) {
    allPersonSegmentation.push({
      height: height,
      width: width,
      data: new Int32Array(height * width).fill(-1),
      pose: posesAboveScores[k]
    });
  }

  const scale = inputResolution / (padT + padB + height);
  const outputResolution = Math.round((inputResolution - 1.0) / stride + 1.0);
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const n = i * width + j;
      const prob = segmentation[n];
      if (prob === 1) {
        let nn = 0;
        if (longOffsetsResized) {
          nn = i * width + j;
        } else {
          const yResized =
              Math.round(((padT + i + 1.0) * scale - 1.0) / stride);
          const xResized =
              Math.round(((padL + j + 1.0) * scale - 1.0) / stride);
          nn = yResized * outputResolution + xResized;
        }
        // 1) finds the pixel's embedding vector for all keypoints
        // 2) loops over the poses and find the instnace k that is close to the
        //    embedding at the pixel and assign k to the pixel (i, j).
        let embed = [];
        for (let p = 0; p < NUM_KPT_TO_USE; p++) {
          let dy = longOffsets[17 * (2 * nn) + p];
          let dx = longOffsets[17 * (2 * nn + 1) + p];
          let y = i + dy;
          let x = j + dx;
          for (let t = 0; t < refineSteps; t++) {
            y = Math.min(Math.round(y), height - 1);
            x = Math.min(Math.round(x), width - 1);
            let nn = 0;
            if (longOffsetsResized) {
              nn = y * width + x;
            } else {
              const yResized =
                  Math.round(((padT + y + 1.0) * scale - 1.0) / stride);
              const xResized =
                  Math.round(((padL + x + 1.0) * scale - 1.0) / stride);
              nn = yResized * outputResolution + xResized;
            }
            dy = longOffsets[17 * (2 * nn) + p];
            dx = longOffsets[17 * (2 * nn + 1) + p];
            y = y + dy;
            x = x + dx;
          }
          embed.push({y: y, x: x});
        }

        let kMin = -1;
        let kMinDist = Infinity;
        for (let k = 0; k < posesAboveScores.length; k++) {
          if (posesAboveScores[k].score > minPoseScore) {
            const dist = computeDistance(embed, posesAboveScores[k]);
            if (dist < kMinDist) {
              kMin = k;
              kMinDist = dist;
            }
          }
        }
        if (kMin >= 0) {
          allPersonSegmentation[kMin].data[n] = partSegmentaion[n];
        }
      }
    }
  }
  return allPersonSegmentation;
}