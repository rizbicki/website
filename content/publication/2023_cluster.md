---
title : "Hierarchical clustering: visualization, feature importance and model selection"
date : 2023-02-02T00:00:00
draft : false

# Authors. Comma separated list, e.g. `["Bob Smith", "David Jones"]`.
authors : [L. M. C. Cabezas, admin, R. B. Stern]

# Publication type.
# Legend:
# 0 : Uncategorized
# 1 : Conference paper
# 2 : Journal article
# 3 : Manuscript
# 4 : Report
# 5 : Book
# 6 : Book section
publication_types : ["6"] 

# Publication name and optional abbreviated version.
publication : "Applied Soft Computing Journal"
#publication_short : "In *ICMEW*"

# Abstract and optional shortened version.
abstract : "We propose methods for the analysis of hierarchical clustering that fully use the multi-resolution structure provided by a dendrogram. Specifically, we propose a loss for choosing between clustering methods, a feature importance score and a graphical tool for visualizing the segmentation of features in a dendrogram. Current approaches to these tasks lead to loss of information since they require the user to generate a single partition of the instances by cutting the dendrogram at a specified level. Our proposed methods, instead, use the full structure of the dendrogram. The key insight behind the proposed methods is to view a dendrogram as a phylogeny. This analogy permits the assignment of a feature value to each internal node of a tree through an evolutionary model. Real and simulated datasets provide evidence that our proposed framework has desirable outcomes and gives more insights than state-of-art approaches. We provide an R package that implements our methods. "
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
tags : ["Machine Learning","Explainable ML","Interpretation","Regression","Nonparametric Inference"]

# Links (optional).
#url_pdf : "https://www.sciencedirect.com/science/article/pii/S0893608023001156"
url_preprint : "https://arxiv.org/abs/2112.01372"
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