// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

// https://github.com/unicode-org/icu4x/blob/main/documents/process/boilerplate.md#library-annotations
#![cfg_attr(all(not(test), not(doc)), no_std)]
#![cfg_attr(
    not(test),
    deny(
        clippy::indexing_slicing,
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::exhaustive_structs,
        clippy::exhaustive_enums,
        missing_debug_implementations,
    )
)]

//! `writeable` is a utility crate of the [`ICU4X`] project.
//!
//! It includes [`Writeable`], a core trait representing an object that can be written to a
//! sink implementing `std::fmt::Write`. It is an alternative to `std::fmt::Display` with the
//! addition of a function indicating the number of bytes to be written.
//!
//! `Writeable` improves upon `std::fmt::Display` in two ways:
//!
//! 1. More efficient, since the sink can pre-allocate bytes.
//! 2. Smaller code, since the format machinery can be short-circuited.
//!
//! # Examples
//!
//! ```
//! use std::fmt;
//! use writeable::assert_writeable_eq;
//! use writeable::LengthHint;
//! use writeable::Writeable;
//!
//! struct WelcomeMessage<'s> {
//!     pub name: &'s str,
//! }
//!
//! impl<'s> Writeable for WelcomeMessage<'s> {
//!     fn write_to<W: fmt::Write + ?Sized>(&self, sink: &mut W) -> fmt::Result {
//!         sink.write_str("Hello, ")?;
//!         sink.write_str(self.name)?;
//!         sink.write_char('!')?;
//!         Ok(())
//!     }
//!
//!     fn writeable_length_hint(&self) -> LengthHint {
//!         // "Hello, " + '!' + length of name
//!         LengthHint::exact(8 + self.name.len())
//!     }
//! }
//!
//! let message = WelcomeMessage { name: "Alice" };
//! assert_writeable_eq!(&message, "Hello, Alice!");
//!
//! // Types implementing `Writeable` are recommended to also implement `fmt::Display`.
//! // This can be simply done by redirecting to the `Writeable` implementation:
//! writeable::impl_display_with_writeable!(WelcomeMessage<'_>);
//! ```
//!
//! [`ICU4X`]: ../icu/index.html

extern crate alloc;

mod cmp;
#[cfg(feature = "either")]
mod either;
mod impls;
mod ops;
mod parts_write_adapter;
mod testing;
mod try_writeable;

use alloc::borrow::Cow;
use alloc::string::String;
use core::fmt;

pub use try_writeable::TryWriteable;

/// Helper types for trait impls.
pub mod adapters {
    use super::*;

    pub use parts_write_adapter::CoreWriteAsPartsWrite;
    pub use try_writeable::TryWriteableInfallibleAsWriteable;
    pub use try_writeable::WriteableAsTryWriteableInfallible;
}

#[doc(hidden)]
pub mod _internal {
    pub use super::testing::try_writeable_to_parts_for_test;
    pub use super::testing::writeable_to_parts_for_test;
}

/// A hint to help consumers of `Writeable` pre-allocate bytes before they call
/// [`write_to`](Writeable::write_to).
///
/// This behaves like `Iterator::size_hint`: it is a tuple where the first element is the
/// lower bound, and the second element is the upper bound. If the upper bound is `None`
/// either there is no known upper bound, or the upper bound is larger than `usize`.
///
/// `LengthHint` implements std`::ops::{Add, Mul}` and similar traits for easy composition.
/// During computation, the lower bound will saturate at `usize::MAX`, while the upper
/// bound will become `None` if `usize::MAX` is exceeded.
#[derive(Debug, PartialEq, Eq, Copy, Clone)]
#[non_exhaustive]
pub struct LengthHint(pub usize, pub Option<usize>);

impl LengthHint {
    pub fn undefined() -> Self {
        Self(0, None)
    }

    /// `write_to` will use exactly n bytes.
    pub fn exact(n: usize) -> Self {
        Self(n, Some(n))
    }

    /// `write_to` will use at least n bytes.
    pub fn at_least(n: usize) -> Self {
        Self(n, None)
    }

    /// `write_to` will use at most n bytes.
    pub fn at_most(n: usize) -> Self {
        Self(0, Some(n))
    }

    /// `write_to` will use between `n` and `m` bytes.
    pub fn between(n: usize, m: usize) -> Self {
        Self(Ord::min(n, m), Some(Ord::max(n, m)))
    }

    /// Returns a recommendation for the number of bytes to pre-allocate.
    /// If an upper bound exists, this is used, otherwise the lower bound
    /// (which might be 0).
    ///
    /// # Examples
    ///
    /// ```
    /// use writeable::Writeable;
    ///
    /// fn pre_allocate_string(w: &impl Writeable) -> String {
    ///     String::with_capacity(w.writeable_length_hint().capacity())
    /// }
    /// ```
    pub fn capacity(&self) -> usize {
        self.1.unwrap_or(self.0)
    }

    /// Returns whether the `LengthHint` indicates that the string is exactly 0 bytes long.
    pub fn is_zero(&self) -> bool {
        self.1 == Some(0)
    }
}

/// [`Part`]s are used as annotations for formatted strings. For example, a string like
/// `Alice, Bob` could assign a `NAME` part to the substrings `Alice` and `Bob`, and a
/// `PUNCTUATION` part to `, `. This allows for example to apply styling only to names.
///
/// `Part` contains two fields, whose usage is left up to the producer of the [`Writeable`].
/// Conventionally, the `category` field will identify the formatting logic that produces
/// the string/parts, whereas the `value` field will have semantic meaning. `NAME` and
/// `PUNCTUATION` could thus be defined as
/// ```
/// # use writeable::Part;
/// const NAME: Part = Part {
///     category: "userlist",
///     value: "name",
/// };
/// const PUNCTUATION: Part = Part {
///     category: "userlist",
///     value: "punctuation",
/// };
/// ```
///
/// That said, consumers should not usually have to inspect `Part` internals. Instead,
/// formatters should expose the `Part`s they produces as constants.
#[derive(Clone, Copy, Debug, PartialEq)]
#[allow(clippy::exhaustive_structs)] // stable
pub struct Part {
    pub category: &'static str,
    pub value: &'static str,
}

impl Part {
    /// A part that should annotate error segments in [`TryWriteable`] output.
    ///
    /// For an example, see [`TryWriteable`].
    pub const ERROR: Part = Part {
        category: "writeable",
        value: "error",
    };
}

/// A sink that supports annotating parts of the string with `Part`s.
pub trait PartsWrite: fmt::Write {
    type SubPartsWrite: PartsWrite + ?Sized;

    fn with_part(
        &mut self,
        part: Part,
        f: impl FnMut(&mut Self::SubPartsWrite) -> fmt::Result,
    ) -> fmt::Result;
}

/// `Writeable` is an alternative to `std::fmt::Display` with the addition of a length function.
pub trait Writeable {
    /// Writes a string to the given sink. Errors from the sink are bubbled up.
    /// The default implementation delegates to `write_to_parts`, and discards any
    /// `Part` annotations.
    fn write_to<W: fmt::Write + ?Sized>(&self, sink: &mut W) -> fmt::Result {
        self.write_to_parts(&mut parts_write_adapter::CoreWriteAsPartsWrite(sink))
    }

    /// Write bytes and `Part` annotations to the given sink. Errors from the
    /// sink are bubbled up. The default implementation delegates to `write_to`,
    /// and doesn't produce any `Part` annotations.
    fn write_to_parts<S: PartsWrite + ?Sized>(&self, sink: &mut S) -> fmt::Result {
        self.write_to(sink)
    }

    /// Returns a hint for the number of UTF-8 bytes that will be written to the sink.
    ///
    /// Override this method if it can be computed quickly.
    fn writeable_length_hint(&self) -> LengthHint {
        LengthHint::undefined()
    }

    /// Creates a new `String` with the data from this `Writeable`. Like `ToString`,
    /// but smaller and faster.
    ///
    /// The default impl allocates an owned `String`. However, if it is possible to return a
    /// borrowed string, overwrite this method to return a `Cow::Borrowed`.
    ///
    /// To remove the `Cow` wrapper, call `.into_owned()` or `.as_str()` as appropriate.
    ///
    /// # Examples
    ///
    /// Inspect a `Writeable` before writing it to the sink:
    ///
    /// ```
    /// use core::fmt::{Result, Write};
    /// use writeable::Writeable;
    ///
    /// fn write_if_ascii<W, S>(w: &W, sink: &mut S) -> Result
    /// where
    ///     W: Writeable + ?Sized,
    ///     S: Write + ?Sized,
    /// {
    ///     let s = w.write_to_string();
    ///     if s.is_ascii() {
    ///         sink.write_str(&s)
    ///     } else {
    ///         Ok(())
    ///     }
    /// }
    /// ```
    ///
    /// Convert the `Writeable` into a fully owned `String`:
    ///
    /// ```
    /// use writeable::Writeable;
    ///
    /// fn make_string(w: &impl Writeable) -> String {
    ///     w.write_to_string().into_owned()
    /// }
    /// ```
    fn write_to_string(&self) -> Cow<str> {
        let hint = self.writeable_length_hint();
        if hint.is_zero() {
            return Cow::Borrowed("");
        }
        let mut output = String::with_capacity(hint.capacity());
        let _ = self.write_to(&mut output);
        Cow::Owned(output)
    }

    /// Compares the contents of this `Writeable` to the given bytes
    /// without allocating a String to hold the `Writeable` contents.
    ///
    /// This returns a lexicographical comparison, the same as if the Writeable
    /// were first converted to a String and then compared with `Ord`. For a
    /// locale-sensitive string ordering, use an ICU4X Collator.
    ///
    /// # Examples
    ///
    /// ```
    /// use core::cmp::Ordering;
    /// use core::fmt;
    /// use writeable::Writeable;
    ///
    /// struct WelcomeMessage<'s> {
    ///     pub name: &'s str,
    /// }
    ///
    /// impl<'s> Writeable for WelcomeMessage<'s> {
    ///     // see impl in Writeable docs
    /// #    fn write_to<W: fmt::Write + ?Sized>(&self, sink: &mut W) -> fmt::Result {
    /// #        sink.write_str("Hello, ")?;
    /// #        sink.write_str(self.name)?;
    /// #        sink.write_char('!')?;
    /// #        Ok(())
    /// #    }
    /// }
    ///
    /// let message = WelcomeMessage { name: "Alice" };
    /// let message_str = message.write_to_string();
    ///
    /// assert_eq!(Ordering::Equal, message.writeable_cmp_bytes(b"Hello, Alice!"));
    ///
    /// assert_eq!(Ordering::Greater, message.writeable_cmp_bytes(b"Alice!"));
    /// assert_eq!(Ordering::Greater, (*message_str).cmp("Alice!"));
    ///
    /// assert_eq!(Ordering::Less, message.writeable_cmp_bytes(b"Hello, Bob!"));
    /// assert_eq!(Ordering::Less, (*message_str).cmp("Hello, Bob!"));
    /// ```
    fn writeable_cmp_bytes(&self, other: &[u8]) -> core::cmp::Ordering {
        let mut wc = cmp::WriteComparator::new(other);
        let _ = self.write_to(&mut wc);
        wc.finish().reverse()
    }
}

/// Implements [`Display`](core::fmt::Display) for types that implement [`Writeable`].
///
/// It's recommended to do this for every [`Writeable`] type, as it will add
/// support for `core::fmt` features like [`fmt!`](std::fmt),
/// [`print!`](std::print), [`write!`](std::write), etc.
#[macro_export]
macro_rules! impl_display_with_writeable {
    ($type:ty) => {
        /// This trait is implemented for compatibility with [`fmt!`](alloc::fmt).
        /// To create a string, [`Writeable::write_to_string`] is usually more efficient.
        impl core::fmt::Display for $type {
            #[inline]
            fn fmt(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
                $crate::Writeable::write_to(&self, f)
            }
        }
    };
}

/// Testing macros for types implementing [`Writeable`].
///
/// Arguments, in order:
///
/// 1. The [`Writeable`] under test
/// 2. The expected string value
/// 3. [`*_parts_eq`] only: a list of parts (`[(start, end, Part)]`)
///
/// Any remaining arguments get passed to `format!`
///
/// The macros tests the following:
///
/// - Equality of string content
/// - Equality of parts ([`*_parts_eq`] only)
/// - Validity of size hint
/// - Reflexivity of `cmp_bytes` and order against largest and smallest strings
///
/// # Examples
///
/// ```
/// # use writeable::Writeable;
/// # use writeable::LengthHint;
/// # use writeable::Part;
/// # use writeable::assert_writeable_eq;
/// # use writeable::assert_writeable_parts_eq;
/// # use std::fmt::{self, Write};
///
/// const WORD: Part = Part {
///     category: "foo",
///     value: "word",
/// };
///
/// struct Demo;
/// impl Writeable for Demo {
///     fn write_to_parts<S: writeable::PartsWrite + ?Sized>(
///         &self,
///         sink: &mut S,
///     ) -> fmt::Result {
///         sink.with_part(WORD, |w| w.write_str("foo"))
///     }
///     fn writeable_length_hint(&self) -> LengthHint {
///         LengthHint::exact(3)
///     }
/// }
///
/// writeable::impl_display_with_writeable!(Demo);
///
/// assert_writeable_eq!(&Demo, "foo");
/// assert_writeable_eq!(&Demo, "foo", "Message: {}", "Hello World");
///
/// assert_writeable_parts_eq!(&Demo, "foo", [(0, 3, WORD)]);
/// assert_writeable_parts_eq!(
///     &Demo,
///     "foo",
///     [(0, 3, WORD)],
///     "Message: {}",
///     "Hello World"
/// );
/// ```
///
/// [`*_parts_eq`]: assert_writeable_parts_eq
#[macro_export]
macro_rules! assert_writeable_eq {
    ($actual_writeable:expr, $expected_str:expr $(,)?) => {
        $crate::assert_writeable_eq!($actual_writeable, $expected_str, "")
    };
    ($actual_writeable:expr, $expected_str:expr, $($arg:tt)+) => {{
        $crate::assert_writeable_eq!(@internal, $actual_writeable, $expected_str, $($arg)*);
    }};
    (@internal, $actual_writeable:expr, $expected_str:expr, $($arg:tt)+) => {{
        let actual_writeable = &$actual_writeable;
        let (actual_str, actual_parts) = $crate::_internal::writeable_to_parts_for_test(actual_writeable);
        let actual_len = actual_str.len();
        assert_eq!(actual_str, $expected_str, $($arg)*);
        assert_eq!(actual_str, $crate::Writeable::write_to_string(actual_writeable), $($arg)+);
        let length_hint = $crate::Writeable::writeable_length_hint(actual_writeable);
        let lower = length_hint.0;
        assert!(
            lower <= actual_len,
            "hint lower bound {lower} larger than actual length {actual_len}: {}",
            format!($($arg)*),
        );
        if let Some(upper) = length_hint.1 {
            assert!(
                actual_len <= upper,
                "hint upper bound {upper} smaller than actual length {actual_len}: {}",
                format!($($arg)*),
            );
        }
        assert_eq!(actual_writeable.to_string(), $expected_str);
        let ordering = $crate::Writeable::writeable_cmp_bytes(actual_writeable, $expected_str.as_bytes());
        assert_eq!(ordering, core::cmp::Ordering::Equal, $($arg)*);
        let ordering = $crate::Writeable::writeable_cmp_bytes(actual_writeable, "\u{10FFFF}".as_bytes());
        assert_eq!(ordering, core::cmp::Ordering::Less, $($arg)*);
        if $expected_str != "" {
            let ordering = $crate::Writeable::writeable_cmp_bytes(actual_writeable, "".as_bytes());
            assert_eq!(ordering, core::cmp::Ordering::Greater, $($arg)*);
        }
        actual_parts // return for assert_writeable_parts_eq
    }};
}

/// See [`assert_writeable_eq`].
#[macro_export]
macro_rules! assert_writeable_parts_eq {
    ($actual_writeable:expr, $expected_str:expr, $expected_parts:expr $(,)?) => {
        $crate::assert_writeable_parts_eq!($actual_writeable, $expected_str, $expected_parts, "")
    };
    ($actual_writeable:expr, $expected_str:expr, $expected_parts:expr, $($arg:tt)+) => {{
        let actual_parts = $crate::assert_writeable_eq!(@internal, $actual_writeable, $expected_str, $($arg)*);
        assert_eq!(actual_parts, $expected_parts, $($arg)+);
    }};
}
