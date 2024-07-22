---
abstract: An open scientific challenge is how to classify events with reliable measures of uncertainty, when we have a mechanistic model of the data-generating process but the distribution over both labels and latent nuisance parameters is different between train and target data. We refer to this type of distributional shift as generalized label shift (GLS). Direct classification using observed data X as covariates leads to biased predictions and invalid uncertainty estimates of labels Y. We overcome these biases by proposing a new method for robust uncertainty quantification that casts classification as a hypothesis testing problem under nuisance parameters. The key idea is to estimate the classifier's receiver operating characteristic (ROC) across the entire nuisance parameter space, which allows us to devise cutoffs that are invariant under GLS. Our method effectively endows a pre-trained classifier with domain adaptation capabilities and returns valid prediction sets while maintaining high power. We demonstrate its performance on two challenging scientific problems in biology and astroparticle physics with data from realistic mechanistic models. 
authors:
- L. Masserano
- A. Shen
- M. Doro
- T. Dorigo
- admin
- A. B. Lee
date: "2024-05-01T00:00:00Z"
doi: ""
featured: true
image:
  caption: ''
  focal_point: ""
  preview_only: false
publication: "Proceedings of Machine Learning Research (ICML Track)"
#publication_short: In *Journal of Machine Learning Research*
publication_types:
- "2"
publishDate: "2024-05-01T00:00:00Z"
project: 
slides: 
summary: The paper introduces a novel approach to classifying events under generalized label shift by framing classification as hypothesis testing, which leads to valid uncertainty quantification. This is demonstrated through applications in biology and astroparticle physics.
tags: [LFI,Machine Learning,Likelihood Free Inference,Bayesian Statistics,Inference]
title: 'Classification under Nuisance Parameters and Generalized Label Shift in Likelihood-Free Inference'
url_code: ""
url_dataset: ""
url_pdf: "https://arxiv.org/abs/2402.05330"
url_poster: ""
url_project: ""
url_slides: ""
url_source: ""
url_video: ""
---
