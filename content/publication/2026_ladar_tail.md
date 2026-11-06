---
title : "Trustworthy Predictive Distributions for Tail Events with Semiparametric Diagnostic Transport Maps"
date : 2026-11-06T00:00:00
draft : false

# Authors. Comma separated list, e.g. `["Bob Smith", "David Jones"]`.
authors : [Elizabeth Cucuzzella, admin, Ann B. Lee]

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
publication : "ASA Discoveries, to appear"
#publication_short : ""

# Abstract and optional shortened version.
abstract : "Machine learning forecast systems are moving beyond point predictions to full predictive distributions for future outcomes y conditional on complex inputs x. However, these distributions are often locally miscalibrated, especially for high-stakes tail events where accurate uncertainty quantification is most needed to establish trust in models. Local miscalibration occurs because training data often lack examples of low-frequency events. The goal of this paper is to describe a simple, yet flexible framework that, at deployment, produces interpretable diagnostics and a robust correction mechanism of predictive distributions when train examples are limited. With this goal in mind, we introduce a semiparametric version of the Local Amortized Diagnostic and Reshaping (LADaR) framework that posits a covariate-dependent parametric model for a diagnostic transport map regressed nonparametrically on inputs to describe how to correct tail probabilities across the feature space to match calibration data. These maps provide the user with local, real-time diagnostics and a reshaped predictive distribution that can be related back to physical processes in the input space. We apply these semiparametric diagnostic transport maps to short-term tropical cyclone intensity forecasting to detect evolutionary modes linked to local miscalibration in the National Hurricane Center's forecasts and improve predictions for severe weather hazards."
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
tags : ["Uncertainty Quantification","Calibration","Predictive Distributions","Tail Events","Transport Maps","Tropical Cyclones"]

# Links (optional).
url_pdf : "https://arxiv.org/abs/2603.11229"
#url_preprint : ""
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
