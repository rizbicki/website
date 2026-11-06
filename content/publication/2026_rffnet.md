---
title : "RFFNet: large-scale interpretable kernel methods via random Fourier Features"
date : 2026-11-06T00:00:00
draft : false

# Authors. Comma separated list, e.g. `["Bob Smith", "David Jones"]`.
authors : [Mateus Piovezan Otto, admin]

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
publication : "Computational Statistics, 41(7), 144"
#publication_short : ""

# Abstract and optional shortened version.
abstract : "Kernel methods provide a flexible and theoretically grounded approach to nonlinear and nonparametric learning. While memory and run-time requirements hinder their applicability to large datasets, many low-rank kernel approximations, such as random Fourier features, were recently developed to scale up such kernel methods. However, these scalable approaches are based on approximations of isotropic kernels, which cannot remove the influence of irrelevant features. In this work, we design random Fourier features for a family of automatic relevance determination (ARD) kernels, and introduce RFFNet, a new large-scale kernel method that learns the kernel relevances' on the fly via first-order stochastic optimization. We present an effective initialization scheme for the method's non-convex objective function, evaluate if hard-thresholding RFFNet's learned relevances yield a sensible rule for variable selection, and perform an extensive ablation study of RFFNet's components. Numerical validation on simulated and real-world data shows that our approach has a small memory footprint and run-time, achieves low prediction error, and effectively identifies relevant features, thus leading to more interpretable solutions. We supply users with an efficient, PyTorch-based library, that adheres to the scikit-learn standard API and code for fully reproducing our results."
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
tags : ["Kernel Methods","Random Fourier Features","Variable Selection","Interpretable Machine Learning","Large-Scale Learning"]

# Links (optional).
url_pdf : "https://link.springer.com/article/10.1007/s00180-026-01810-x"
url_preprint : "https://arxiv.org/abs/2211.06410"
#url_code : ""
#url_dataset : "#"
#url_project : "#"
#url_slides : "#"
#url_video : "#"
#url_poster : "#"
#url_source : "#"

# Custom links (optional).
#   Uncomment line below to enable. For multiple links, use the form `[{...}, {...}, {...}]`.
#url_custom : [{name : "DOI", url : "https://doi.org/10.1007/s00180-026-01810-x"}]

# Does this page contain LaTeX math? (true/false)
math : true

# Does this page require source code highlighting? (true/false)
highlight : true

---
