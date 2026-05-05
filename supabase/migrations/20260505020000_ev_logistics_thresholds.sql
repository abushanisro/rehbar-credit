-- Rehbar — EV Logistics & Transportation industry thresholds
-- EV fleet businesses are asset-heavy, capital-intensive with lower margins
-- and higher acceptable leverage than general defaults.

INSERT INTO public.ratio_thresholds (industry, category, ratio_name, green_min, amber_min, peer_median, higher_is_better, formula_note) VALUES

-- EFFICIENCY — asset-heavy fleet; lower asset turnover is normal
('EV Logistics & Transportation', 'efficiency', 'asset_turnover',       0.55, 0.30, 0.65, true,  '> 0.55 (EV fleet)'),
('EV Logistics & Transportation', 'efficiency', 'inventory_turnover',   0.0,  0.0,  NULL, true,  'N/A — no inventory in EV logistics'),
('EV Logistics & Transportation', 'efficiency', 'receivables_turnover', 8.0,  5.0,  9.0,  true,  '> 8.0 (quick collection)'),

-- LIQUIDITY — fleets have low current assets relative to capex
('EV Logistics & Transportation', 'liquidity', 'current_ratio', 1.2,  1.0,  1.3,  true, '1.2 – 2.5 (EV fleet)'),
('EV Logistics & Transportation', 'liquidity', 'quick_ratio',   0.9,  0.6,  1.0,  true, '> 0.9 (EV fleet)'),
('EV Logistics & Transportation', 'liquidity', 'cash_ratio',    0.4,  0.2,  0.45, true, '> 0.4 (EV fleet)'),

-- PROFITABILITY — margins compressed by depreciation on EV fleet
('EV Logistics & Transportation', 'profitability', 'gross_margin',      0.22, 0.12, 0.25, true, '> 22% (EV fleet)'),
('EV Logistics & Transportation', 'profitability', 'ebitda_margin',     0.20, 0.12, 0.23, true, '> 20% (EV fleet — depreciation significant)'),
('EV Logistics & Transportation', 'profitability', 'net_profit_margin', 0.06, 0.02, 0.08, true, '> 6% (EV fleet post-depreciation)'),
('EV Logistics & Transportation', 'profitability', 'roa',               0.04, 0.02, 0.05, true, '> 4% (asset-heavy)'),
('EV Logistics & Transportation', 'profitability', 'roe',               0.12, 0.06, 0.14, true, '> 12%'),

-- RETURN
('EV Logistics & Transportation', 'return', 'roce', 0.10, 0.05, 0.12, true, '> 10% (EV fleet)'),
('EV Logistics & Transportation', 'return', 'roic', 0.08, 0.04, 0.10, true, '> 8% (EV fleet)'),
('EV Logistics & Transportation', 'return', 'ronw', 0.10, 0.05, 0.12, true, '> 10%'),

-- SOLVENCY — higher D/E acceptable; EV capex is debt-funded
('EV Logistics & Transportation', 'solvency', 'debt_to_equity',    3.0,  4.5,  2.5,  false, '< 3.0 (EV capital-intensive)'),
('EV Logistics & Transportation', 'solvency', 'debt_to_assets',    0.68, 0.80, 0.62, false, '< 0.68 (EV fleet)'),
('EV Logistics & Transportation', 'solvency', 'interest_coverage', 2.5,  1.5,  3.0,  true,  '> 2.5 (EV fleet)'),

-- COVERAGE — slightly relaxed for asset-backed EV lease structures
('EV Logistics & Transportation', 'coverage', 'dscr', 1.30, 1.10, 1.40, true, '> 1.30 (EV fleet debt service)');
