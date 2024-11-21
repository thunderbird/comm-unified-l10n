// Copyright 2021 Developers of the Rand project.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// https://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or https://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

//! The Fréchet distribution.

use crate::{Distribution, OpenClosed01};
use core::fmt;
use num_traits::Float;
use rand::Rng;

/// Samples floating-point numbers according to the Fréchet distribution
///
/// This distribution has density function:
/// `f(x) = [(x - μ) / σ]^(-1 - α) exp[-(x - μ) / σ]^(-α) α / σ`,
/// where `μ` is the location parameter, `σ` the scale parameter, and `α` the shape parameter.
///
/// # Example
/// ```
/// use rand::prelude::*;
/// use rand_distr::Frechet;
///
/// let val: f64 = thread_rng().sample(Frechet::new(0.0, 1.0, 1.0).unwrap());
/// println!("{}", val);
/// ```
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde1", derive(serde::Serialize, serde::Deserialize))]
pub struct Frechet<F>
where
    F: Float,
    OpenClosed01: Distribution<F>,
{
    location: F,
    scale: F,
    shape: F,
}

/// Error type returned from `Frechet::new`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// location is infinite or NaN
    LocationNotFinite,
    /// scale is not finite positive number
    ScaleNotPositive,
    /// shape is not finite positive number
    ShapeNotPositive,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Error::LocationNotFinite => "location is not finite in Frechet distribution",
            Error::ScaleNotPositive => "scale is not positive and finite in Frechet distribution",
            Error::ShapeNotPositive => "shape is not positive and finite in Frechet distribution",
        })
    }
}

#[cfg(feature = "std")]
#[cfg_attr(doc_cfg, doc(cfg(feature = "std")))]
impl std::error::Error for Error {}

impl<F> Frechet<F>
where
    F: Float,
    OpenClosed01: Distribution<F>,
{
    /// Construct a new `Frechet` distribution with given `location`, `scale`, and `shape`.
    pub fn new(location: F, scale: F, shape: F) -> Result<Frechet<F>, Error> {
        if scale <= F::zero() || scale.is_infinite() || scale.is_nan() {
            return Err(Error::ScaleNotPositive);
        }
        if shape <= F::zero() || shape.is_infinite() || shape.is_nan() {
            return Err(Error::ShapeNotPositive);
        }
        if location.is_infinite() || location.is_nan() {
            return Err(Error::LocationNotFinite);
        }
        Ok(Frechet {
            location,
            scale,
            shape,
        })
    }
}

impl<F> Distribution<F> for Frechet<F>
where
    F: Float,
    OpenClosed01: Distribution<F>,
{
    fn sample<R: Rng + ?Sized>(&self, rng: &mut R) -> F {
        let x: F = rng.sample(OpenClosed01);
        self.location + self.scale * (-x.ln()).powf(-self.shape.recip())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic]
    fn test_zero_scale() {
        Frechet::new(0.0, 0.0, 1.0).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_infinite_scale() {
        Frechet::new(0.0, core::f64::INFINITY, 1.0).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_nan_scale() {
        Frechet::new(0.0, core::f64::NAN, 1.0).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_zero_shape() {
        Frechet::new(0.0, 1.0, 0.0).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_infinite_shape() {
        Frechet::new(0.0, 1.0, core::f64::INFINITY).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_nan_shape() {
        Frechet::new(0.0, 1.0, core::f64::NAN).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_infinite_location() {
        Frechet::new(core::f64::INFINITY, 1.0, 1.0).unwrap();
    }

    #[test]
    #[should_panic]
    fn test_nan_location() {
        Frechet::new(core::f64::NAN, 1.0, 1.0).unwrap();
    }

    #[test]
    fn test_sample_against_cdf() {
        fn quantile_function(x: f64) -> f64 {
            (-x.ln()).recip()
        }
        let location = 0.0;
        let scale = 1.0;
        let shape = 1.0;
        let iterations = 100_000;
        let increment = 1.0 / iterations as f64;
        let probabilities = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
        let mut quantiles = [0.0; 9];
        for (i, p) in probabilities.iter().enumerate() {
            quantiles[i] = quantile_function(*p);
        }
        let mut proportions = [0.0; 9];
        let d = Frechet::new(location, scale, shape).unwrap();
        let mut rng = crate::test::rng(1);
        for _ in 0..iterations {
            let replicate = d.sample(&mut rng);
            for (i, q) in quantiles.iter().enumerate() {
                if replicate < *q {
                    proportions[i] += increment;
                }
            }
        }
        assert!(proportions
            .iter()
            .zip(&probabilities)
            .all(|(p_hat, p)| (p_hat - p).abs() < 0.003))
    }
}
