-- Rehbar — New Ratio Model Migration (FinAnalyzer overhaul)
-- Clears old thresholds and inserts comprehensive 7-category set
-- with industry-specific overrides.

DELETE FROM public.ratio_thresholds;

-- ============================================================
-- DEFAULT thresholds (all ratios, all industries fall back here)
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES

-- EFFICIENCY
('default', 'efficiency', 'asset_turnover',       1.0,  0.5,  1.2,  true,  '> 1.0'),
('default', 'efficiency', 'inventory_turnover',    5.0,  3.0,  6.0,  true,  '> 5.0'),
('default', 'efficiency', 'receivables_turnover',  6.0,  4.0,  8.0,  true,  '> 6.0'),

-- LIQUIDITY
('default', 'liquidity', 'current_ratio',  1.5,  1.0,  1.6,  true,  '1.5 – 3.0'),
('default', 'liquidity', 'quick_ratio',    1.0,  0.7,  1.1,  true,  '1.0 – 2.0'),
('default', 'liquidity', 'cash_ratio',     0.5,  0.2,  0.35, true,  '> 0.5'),

-- PROFITABILITY
('default', 'profitability', 'gross_margin',       0.30, 0.15, 0.32, true, '> 30%'),
('default', 'profitability', 'ebitda_margin',      0.15, 0.08, 0.18, true, '> 15%'),
('default', 'profitability', 'net_profit_margin',  0.10, 0.05, 0.10, true, '> 10%'),
('default', 'profitability', 'roa',                0.05, 0.02, 0.07, true, '> 5%'),
('default', 'profitability', 'roe',                0.15, 0.08, 0.18, true, '> 15%'),

-- RETURN
('default', 'return', 'roce',  0.15, 0.08, 0.18, true, '> 15%'),
('default', 'return', 'roic',  0.12, 0.06, 0.14, true, '> 12%'),
('default', 'return', 'ronw',  0.12, 0.06, 0.14, true, '> 12%'),

-- SOLVENCY
('default', 'solvency', 'debt_to_equity',    2.0,  3.0,  1.5,  false, '< 2.0'),
('default', 'solvency', 'debt_to_assets',    0.60, 0.75, 0.55, false, '< 0.6'),
('default', 'solvency', 'interest_coverage', 3.0,  1.5,  4.0,  true,  '> 3.0'),

-- COVERAGE
('default', 'coverage', 'dscr', 1.5, 1.25, 1.6, true, '> 1.25'),

-- R'' SCORE
('default', 'r_score', 'r_score_composite',  2.0,  1.0,  2.5,  true, '> 2.0 Safe | 1.0–2.0 Caution | < 1.0 Distress'),
('default', 'r_score', 'r_score_wc_ta',      0.05, 0.0,  0.08, true, '> 0.05'),
('default', 'r_score', 'r_score_re_ta',      0.10, 0.05, 0.12, true, '> 0.10'),
('default', 'r_score', 'r_score_ebitda_ta',  0.10, 0.05, 0.12, true, '> 0.10'),
('default', 'r_score', 'r_score_equity_ol',  0.20, 0.10, 0.25, true, '> 0.20');

-- ============================================================
-- MANUFACTURING overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('Manufacturing', 'efficiency',    'inventory_turnover', 6.0,  3.0,  7.0,  true, '> 6.0'),
('Manufacturing', 'profitability', 'gross_margin',       0.25, 0.15, 0.28, true, '> 25%');

-- ============================================================
-- TRADING overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('Trading', 'efficiency',    'asset_turnover',      2.0,  0.5,  2.5,  true, '> 2.0'),
('Trading', 'efficiency',    'inventory_turnover',   8.0,  3.0,  10.0, true, '> 8.0'),
('Trading', 'profitability', 'gross_margin',         0.15, 0.08, 0.18, true, '> 15%'),
('Trading', 'profitability', 'net_profit_margin',    0.05, 0.02, 0.06, true, '> 5%');

-- ============================================================
-- IT & TECHNOLOGY overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('IT & Technology', 'efficiency',    'asset_turnover',      0.8,  0.5,  1.0,  true,  '> 0.8'),
('IT & Technology', 'efficiency',    'inventory_turnover',  0.0,  0.0,  NULL, true,  'N/A'),
('IT & Technology', 'profitability', 'gross_margin',        0.50, 0.35, 0.55, true,  '> 50%'),
('IT & Technology', 'profitability', 'ebitda_margin',       0.20, 0.08, 0.22, true,  '> 20%'),
('IT & Technology', 'profitability', 'net_profit_margin',   0.12, 0.05, 0.14, true,  '> 12%'),
('IT & Technology', 'solvency',      'debt_to_equity',      0.5,  1.0,  0.3,  false, '< 0.5');

-- ============================================================
-- HEALTHCARE & PHARMACEUTICALS overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('Healthcare & Pharmaceuticals', 'profitability', 'gross_margin',      0.40, 0.15, 0.42, true, '> 40%'),
('Healthcare & Pharmaceuticals', 'profitability', 'ebitda_margin',     0.20, 0.08, 0.22, true, '> 20%'),
('Healthcare & Pharmaceuticals', 'efficiency',    'inventory_turnover', 8.0,  3.0,  9.0,  true, '> 8.0');

-- ============================================================
-- REAL ESTATE overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('Real Estate', 'efficiency',    'asset_turnover',   0.3,  0.15, 0.4,  true,  '> 0.3'),
('Real Estate', 'liquidity',     'current_ratio',    1.2,  1.0,  1.3,  true,  '1.2 – 2.5'),
('Real Estate', 'profitability', 'gross_margin',     0.25, 0.15, 0.28, true,  '> 25%'),
('Real Estate', 'solvency',      'debt_to_equity',   3.0,  5.0,  2.5,  false, '< 3.0'),
('Real Estate', 'solvency',      'debt_to_assets',   0.70, 0.85, 0.65, false, '< 0.7');

-- ============================================================
-- FINANCIAL SERVICES overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('Financial Services', 'solvency',      'interest_coverage',  2.0,  1.5,  2.5,  true,  '> 2.0'),
('Financial Services', 'solvency',      'debt_to_equity',     8.0,  12.0, 6.0,  false, '< 8.0'),
('Financial Services', 'profitability', 'net_profit_margin',  0.15, 0.05, 0.18, true,  '> 15%');

-- ============================================================
-- AGRICULTURE & FOOD PROCESSING overrides
-- ============================================================
INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES
('Agriculture & Food Processing', 'efficiency',    'inventory_turnover', 4.0,  3.0,  5.0,  true, '> 4.0'),
('Agriculture & Food Processing', 'profitability', 'gross_margin',       0.20, 0.15, 0.22, true, '> 20%'),
('Agriculture & Food Processing', 'liquidity',     'current_ratio',      1.3,  1.0,  1.4,  true, '1.3 – 2.5');
