---
title : "LoBoost: Model-Native Local Conformal Prediction for Gradient-Boosted Trees"
date : 2026-11-06T00:00:00
draft : false

# Authors. Comma separated list, e.g. `["Bob Smith", "David Jones"]`.
authors : [Vagner Santos, Victor Coscrato, Luben Cabezas, admin, Thiago Ramos]

# Publication type.
# Legend:
# 0 : Uncategorized
# 1 : Conference paper
# 2 : Journal article
# 3 : Manuscript
# 4 : Report
# 5 : Book
# 6 : Book section
publication_types : ["2"]

# Publication name and optional abbreviated version.
publication : "Transactions on Machine Learning Research (TMLR)"
#publication_short : ""

# Abstract and optional shortened version.
abstract : "Gradient-boosted decision trees are among the strongest off-the-shelf predictors for tabular regression, but point predictions alone do not quantify uncertainty. Conformal prediction provides distribution-free marginal coverage, yet standard split conformal uses a single global residual quantile and can adapt poorly to heteroscedasticity. We propose LoBoost, a model-native local conformal method that reuses the fitted ensemble's leaf structure to define a multiscale partition of the feature space. Each input is represented by the sequence of leaves it visits along the boosting path, and matching leaf prefixes define nested groups in which residual quantiles are estimated locally. By reusing the predictive structure already learned by the model, LoBoost requires no auxiliary partition or nuisance model, no retraining, and no additional data split beyond standard conformal calibration. Our theory connects the stability of the fitted ensemble and the geometry of its induced cells to local residual-score homogeneity, providing finite-sample coverage-error control and asymptotic pointwise validity as the local calibration size grows and the cells become sufficiently homogeneous. Experiments show competitive interval quality, low post-hoc calibration costs, and stable behavior across local calibration-size settings."
abstract_short : ""

# Featured image thumbnail (optional)
image_preview : ""

# Is this a selected publication? (true/false)
selected : false

# Projects (optional).
#   Associate this publication with one or more of your projects.
#   Simply enter your project's filename without extension.
#   E.g. `projects : ["deep-learning"]` references `content/project/deep-learning.md`.
#   Otherwise, set `projects : []`.
# projects : ["example-external-project"]

# Tags (optional).
#   Set `tags : []` for no tags, or use the form `tags : ["A Tag", "Another Tag"]` for one or more tags.
tags : ["Conformal Prediction","Gradient Boosting","Uncertainty Quantification","Local Calibration","Prediction Intervals"]

# Links (optional).
url_pdf : "https://openreview.net/forum?id=RdQbKSjMHX"
url_preprint : "https://arxiv.org/abs/2602.22432"
#url_code : ""
#url_dataset : "#"
#url_project : "#"
#url_slides : "#"
#url_video : "#"
#url_poster : "#"
#url_source : "#"

# Custom links (optional).
#   Uncomment line below to enable. For multiple links, use the form `[{...}, {...}, {...}]`.
#url_custom : [{name : "Custom Link", url : "http://example.org"}]

# Does this page contain LaTeX math? (true/false)
math : true

# Does this page require source code highlighting? (true/false)
highlight : true

---
