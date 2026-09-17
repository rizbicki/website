---
title : "Benchmarking Tabular Foundation Models for Conditional Density Estimation in Regression"
date : 2026-09-01T00:01:00
draft : false

# Authors. Comma separated list, e.g. `["Bob Smith", "David Jones"]`.
authors : [admin, Pedro L. C. Rodrigues]

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
publication : "Transactions on Machine Learning Research"
#publication_short : "In *ICMEW*"

# Abstract and optional shortened version.
abstract : "Conditional density estimation (CDE) -- recovering the full conditional distribution of a response given tabular covariates -- is essential in settings with heteroscedasticity, multimodality, or asymmetric uncertainty. Recent tabular foundation models, such as TabPFN and TabICL, naturally produce predictive distributions, but their effectiveness as general-purpose CDE methods has not been systematically evaluated -- unlike their performance for point prediction, which is well studied. We benchmark three tabular foundation model variants against a diverse set of parametric, tree-based, and neural CDE baselines on 39 real-world datasets, across training sizes from 50 to 20,000, using six metrics covering density accuracy, calibration, and computation time. Across all sample sizes, foundation models achieve the best CDE loss, log-likelihood, and CRPS on the large majority of datasets tested. Calibration is competitive at small sample sizes but, for some metrics and datasets, lags behind task-specific neural baselines at larger sample sizes. However, we show that a post-hoc PIT recalibration step improves absolute calibration of the foundation models while leaving their accuracy advantage intact. In a photometric redshift case study using SDSS DR18, TabPFN exposed to 50,000 training galaxies outperforms all baselines trained on the full 500,000-galaxy dataset. Taken together, these results establish tabular foundation models as strong off-the-shelf conditional density estimators."
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
tags : ["Conditional Density Estimation","Tabular Foundation Models","Benchmarking","TabPFN","TabICL","Uncertainty Quantification","Regression"]

# Links (optional).
url_pdf : "https://openreview.net/pdf?id=KWsWHpp5Do"
#url_preprint : "https://arxiv.org/abs/2508.17077"
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
