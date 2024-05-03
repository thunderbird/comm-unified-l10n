// Copyright 2019 The Fuchsia Authors
//
// Licensed under a BSD-style license <LICENSE-BSD>, Apache License, Version 2.0
// <LICENSE-APACHE or https://www.apache.org/licenses/LICENSE-2.0>, or the MIT
// license <LICENSE-MIT or https://opensource.org/licenses/MIT>, at your option.
// This file may not be copied, modified, or distributed except according to
// those terms.

#![allow(warnings)]

use zerocopy::{AsBytes, FromBytes, FromZeroes, Unaligned};

// Ensure that types that are use'd and types that are referenced by path work.

mod foo {
    use zerocopy::{AsBytes, FromBytes, FromZeroes, Unaligned};

    #[derive(FromZeroes, FromBytes, AsBytes, Unaligned)]
    #[repr(C)]
    pub struct Foo {
        foo: u8,
    }

    #[derive(FromZeroes, FromBytes, AsBytes, Unaligned)]
    #[repr(C)]
    pub struct Bar {
        bar: u8,
    }
}

use foo::Foo;

#[derive(FromZeroes, FromBytes, AsBytes, Unaligned)]
#[repr(C)]
struct Baz {
    foo: Foo,
    bar: foo::Bar,
}
