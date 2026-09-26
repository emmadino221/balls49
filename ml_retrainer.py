#!/usr/bin/env python3
import json
import math
import os
import sys
from datetime import datetime, timezone

predictions_file = os.path.join(os.getcwd(), 'predictions.json')
model_file = os.path.join(os.getcwd(), 'ml_retraining_model.json')

if len(sys.argv) >= 2:
    predictions_file = os.path.abspath(sys.argv[1])
if len(sys.argv) >= 3:
    model_file = os.path.abspath(sys.argv[2])

result_map = {
    'u4': 'betzero',
    'color': 'rainbow',
    'sum': 'hilo',
    'totalColor': 'totalColor'
}

feature_key_map = {
    'u4': 'betzero',
    'color': 'rainbow',
    'sum': 'hilo',
    'totalColor': 'totalColor'
}

def safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default

def extract_feature_vector(entry, key):
    """Return a deterministic market feature vector for a single prediction record.

    The vector stays intentionally lightweight and pure-JSON so the stored
    artifact remains dependency-free while still exposing clean fields for a
    future ML model or heuristic scorer.
    """
    predicted = entry.get('predicted') or {}
    brain = entry.get('brainData') or {}
    steps = entry.get('steps') or {}
    score = entry.get('mlScores') or {}
    result = entry.get('result') or {}

    vector = {
        'signal_alignment': 0.0,
        'market_samples_seen': 1,
    }

    target_result_key = result_map.get(key)
    target_status = result.get(target_result_key)
    if target_status == 'WIN':
        vector['signal_alignment'] = 1.0
    elif target_status == 'LOSS':
        vector['signal_alignment'] = -1.0
    elif target_status == 'SKIP':
        vector['signal_alignment'] = 0.0

    if key == 'u4':
        picks = predicted.get('betzero') or []
        bet_count = len(picks) if isinstance(picks, list) else 0
        betzero_brain = brain.get('betzero') or {}
        vector.update({
            'u4_bet_count': bet_count,
            'u4_pick_count': bet_count,
            'u4_pool_size': int(betzero_brain.get('poolSize') or 0),
            'u4_status_active': 1 if betzero_brain.get('status') == 'ACTIVE' else 0,
            'u4_ml_score': safe_float(score.get('betzero'), 0.0),
            'u4_step': int(steps.get('betzero') or 0),
        })
    elif key == 'color':
        rainbow = predicted.get('rainbow')
        rainbow_brain = brain.get('rainbow') or {}
        freqs = rainbow_brain.get('freqs') or {}
        max_freq = max(freqs.values()) if isinstance(freqs, dict) and freqs else safe_float(rainbow_brain.get('maxFreq'), 0.0)
        vector.update({
            'color_selected': 1 if isinstance(rainbow, str) and rainbow else 0,
            'color_max_freq': int(max_freq),
            'color_weighted_max': safe_float(rainbow_brain.get('weightedMax'), 0.0),
            'color_status_active': 1 if rainbow_brain.get('status') == 'ACTIVE' else 0,
            'color_ml_score': safe_float(score.get('rainbow'), 0.0),
            'color_step': int(steps.get('rainbow') or 0),
        })
    elif key == 'sum':
        hilo = predicted.get('hilo') or ''
        hilo_brain = brain.get('hilo') or {}
        vector.update({
            'sum_is_low': 1 if str(hilo).upper() == 'LOW' else 0,
            'sum_is_mid': 1 if str(hilo).upper() == 'MID' else 0,
            'sum_is_high': 1 if str(hilo).upper() == 'HIGH' else 0,
            'sum_opposite_streak_limit': int(hilo_brain.get('oppositeStreakLimit') or 0),
            'sum_ml_score': safe_float(score.get('hilo'), 0.0),
            'sum_step': int(steps.get('hilo') or 0),
        })
    elif key == 'totalColor':
        total_pred = predicted.get('totalColor') or {}
        top_colors = total_pred.get('topColors') or []
        total_brain = brain.get('totalColor') or {}
        vector.update({
            'total_color_top_count': len(top_colors) if isinstance(top_colors, list) else 0,
            'total_color_confidence': safe_float(total_pred.get('confidence'), 0.0),
            'total_color_gap': safe_float(total_pred.get('gap'), 0.0),
            'total_color_status_active': 1 if total_pred.get('status') == 'ACTIVE' or total_brain.get('status') == 'ACTIVE' else 0,
            'total_color_ml_score': safe_float(score.get('totalColor'), 0.0),
            'total_color_step': int(steps.get('totalColor') or 0),
        })

    return vector

def op_to_market_result(entry, key):
    result = entry.get('result') or {}
    target = result_map.get(key)
    if target not in result:
        return None
    return result.get(target)

def parse_prediction_log(path):
    try:
        data = json.load(open(path, 'r', encoding='utf-8'))
        return data if isinstance(data, list) else []
    except Exception:
        return []

def compute_rate(history, key, window):
    target = result_map[key]
    slice_data = history[:window]
    wins = 0
    records = 0
    for item in slice_data:
        res = item.get('result') or {}
        outcome = res.get(target)
        if outcome in ('WIN', 'LOSS'):
            records += 1
            if outcome == 'WIN':
                wins += 1
    if records == 0:
        return 0.50
    return wins / records

def fit_market_models(history):
    market_models = {}
    keys = ['u4', 'color', 'sum', 'totalColor']
    for key in keys:
        window10 = compute_rate(history, key, 10)
        window50 = compute_rate(history, key, 50)
        window100 = compute_rate(history, key, 100)
        observed = (window10 + window50 + window100) / 3
        bias = max(-0.20, min(0.20, (observed - 0.50) * 0.30))
        samples = len(history)
        feature_vector = aggregate_feature_vector(history, key)
        market_models[key] = {
            'samples': samples,
            'bias': round(bias, 4),
            'winRate10': round(window10, 4),
            'winRate50': round(window50, 4),
            'winRate100': round(window100, 4),
            'featureVector': feature_vector,
        }

    return market_models

def aggregate_feature_vector(history, key):
    """Average the last 200 records into stable summary features for the artifact.
    This keeps the retraining model artifact readable, non-binary, and cheap.
    """
    slice_data = history[:200]
    if not slice_data:
        return {}
    weighted = []
    for item in slice_data:
        weighted.append(extract_feature_vector(item, key))

    if not weighted:
        return {}

    # Average every numeric field. Ignore any top-level non-feature metadata.
    feature_keys = sorted({k for v in weighted for k in v.keys()})
    vector = {}
    for field in feature_keys:
        values = []
        for item in weighted:
            value = item.get(field, 0)
            try:
                values.append(float(value))
            except Exception:
                continue
        if values:
            vector[field] = round(sum(values) / len(values), 4)

    return vector

def main():
    history = parse_prediction_log(predictions_file)
    if len(history) == 0:
        history = []

    # Use only a bounded, last-1000 row slice so the server stays lightweight.
    history = history[:1000]

    model = {
        'version': 2,
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'marketModels': fit_market_models(history)
    }

    os.makedirs(os.path.dirname(model_file) or '.', exist_ok=True)
    with open(model_file, 'w', encoding='utf-8') as fh:
        json.dump(model, fh, indent=2)

if __name__ == '__main__':
    main()
