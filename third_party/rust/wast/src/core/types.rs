use crate::core::*;
use crate::kw;
use crate::parser::{Cursor, Parse, Parser, Peek, Result};
use crate::token::{Id, Index, LParen, NameAnnotation, Span};
use crate::Error;
use std::mem;

/// The value types for a wasm module.
#[allow(missing_docs)]
#[derive(Debug, PartialEq, Eq, Hash, Copy, Clone)]
pub enum ValType<'a> {
    I32,
    I64,
    F32,
    F64,
    V128,
    Ref(RefType<'a>),
}

impl<'a> Parse<'a> for ValType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut l = parser.lookahead1();
        if l.peek::<kw::i32>()? {
            parser.parse::<kw::i32>()?;
            Ok(ValType::I32)
        } else if l.peek::<kw::i64>()? {
            parser.parse::<kw::i64>()?;
            Ok(ValType::I64)
        } else if l.peek::<kw::f32>()? {
            parser.parse::<kw::f32>()?;
            Ok(ValType::F32)
        } else if l.peek::<kw::f64>()? {
            parser.parse::<kw::f64>()?;
            Ok(ValType::F64)
        } else if l.peek::<kw::v128>()? {
            parser.parse::<kw::v128>()?;
            Ok(ValType::V128)
        } else if l.peek::<RefType>()? {
            Ok(ValType::Ref(parser.parse()?))
        } else {
            Err(l.error())
        }
    }
}

impl<'a> Peek for ValType<'a> {
    fn peek(cursor: Cursor<'_>) -> Result<bool> {
        Ok(kw::i32::peek(cursor)?
            || kw::i64::peek(cursor)?
            || kw::f32::peek(cursor)?
            || kw::f64::peek(cursor)?
            || kw::v128::peek(cursor)?
            || RefType::peek(cursor)?)
    }
    fn display() -> &'static str {
        "valtype"
    }
}

/// A heap type for a reference type
#[allow(missing_docs)]
#[derive(Debug, PartialEq, Eq, Hash, Copy, Clone)]
pub enum HeapType<'a> {
    /// An untyped function reference: funcref. This is part of the reference
    /// types proposal.
    Func,
    /// A reference to any host value: externref. This is part of the reference
    /// types proposal.
    Extern,
    /// A reference to a wasm exception. This is part of the exceptions proposal.
    Exn,
    /// A reference to any reference value: anyref. This is part of the GC
    /// proposal.
    Any,
    /// A reference that has an identity that can be compared: eqref. This is
    /// part of the GC proposal.
    Eq,
    /// A reference to a GC struct. This is part of the GC proposal.
    Struct,
    /// A reference to a GC array. This is part of the GC proposal.
    Array,
    /// An unboxed 31-bit integer: i31ref. Part of the GC proposal.
    I31,
    /// The bottom type of the funcref hierarchy. Part of the GC proposal.
    NoFunc,
    /// The bottom type of the externref hierarchy. Part of the GC proposal.
    NoExtern,
    /// The bottom type of the anyref hierarchy. Part of the GC proposal.
    None,
    /// The bottom type of the exnref hierarchy. Part of the exceptions proposal.
    NoExn,
    /// A reference to a concrete function, struct, or array type defined by
    /// Wasm: `ref T`. This is part of the function references and GC proposals.
    Concrete(Index<'a>),
}

impl<'a> Parse<'a> for HeapType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut l = parser.lookahead1();
        if l.peek::<kw::func>()? {
            parser.parse::<kw::func>()?;
            Ok(HeapType::Func)
        } else if l.peek::<kw::r#extern>()? {
            parser.parse::<kw::r#extern>()?;
            Ok(HeapType::Extern)
        } else if l.peek::<kw::exn>()? {
            parser.parse::<kw::exn>()?;
            Ok(HeapType::Exn)
        } else if l.peek::<kw::r#any>()? {
            parser.parse::<kw::r#any>()?;
            Ok(HeapType::Any)
        } else if l.peek::<kw::eq>()? {
            parser.parse::<kw::eq>()?;
            Ok(HeapType::Eq)
        } else if l.peek::<kw::r#struct>()? {
            parser.parse::<kw::r#struct>()?;
            Ok(HeapType::Struct)
        } else if l.peek::<kw::array>()? {
            parser.parse::<kw::array>()?;
            Ok(HeapType::Array)
        } else if l.peek::<kw::i31>()? {
            parser.parse::<kw::i31>()?;
            Ok(HeapType::I31)
        } else if l.peek::<kw::nofunc>()? {
            parser.parse::<kw::nofunc>()?;
            Ok(HeapType::NoFunc)
        } else if l.peek::<kw::noextern>()? {
            parser.parse::<kw::noextern>()?;
            Ok(HeapType::NoExtern)
        } else if l.peek::<kw::noexn>()? {
            parser.parse::<kw::noexn>()?;
            Ok(HeapType::NoExn)
        } else if l.peek::<kw::none>()? {
            parser.parse::<kw::none>()?;
            Ok(HeapType::None)
        } else if l.peek::<Index>()? {
            Ok(HeapType::Concrete(parser.parse()?))
        } else {
            Err(l.error())
        }
    }
}

impl<'a> Peek for HeapType<'a> {
    fn peek(cursor: Cursor<'_>) -> Result<bool> {
        Ok(kw::func::peek(cursor)?
            || kw::r#extern::peek(cursor)?
            || kw::exn::peek(cursor)?
            || kw::any::peek(cursor)?
            || kw::eq::peek(cursor)?
            || kw::r#struct::peek(cursor)?
            || kw::array::peek(cursor)?
            || kw::i31::peek(cursor)?
            || kw::nofunc::peek(cursor)?
            || kw::noextern::peek(cursor)?
            || kw::noexn::peek(cursor)?
            || kw::none::peek(cursor)?
            || (LParen::peek(cursor)? && kw::r#type::peek2(cursor)?))
    }
    fn display() -> &'static str {
        "heaptype"
    }
}

/// A reference type in a wasm module.
#[allow(missing_docs)]
#[derive(Debug, PartialEq, Eq, Hash, Copy, Clone)]
pub struct RefType<'a> {
    pub nullable: bool,
    pub heap: HeapType<'a>,
}

impl<'a> RefType<'a> {
    /// A `funcref` as an abbreviation for `(ref null func)`.
    pub fn func() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Func,
        }
    }

    /// An `externref` as an abbreviation for `(ref null extern)`.
    pub fn r#extern() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Extern,
        }
    }

    /// An `exnrefr` as an abbreviation for `(ref null exn)`.
    pub fn exn() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Exn,
        }
    }

    /// An `anyref` as an abbreviation for `(ref null any)`.
    pub fn any() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Any,
        }
    }

    /// An `eqref` as an abbreviation for `(ref null eq)`.
    pub fn eq() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Eq,
        }
    }

    /// An `structref` as an abbreviation for `(ref null struct)`.
    pub fn r#struct() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Struct,
        }
    }

    /// An `arrayref` as an abbreviation for `(ref null array)`.
    pub fn array() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::Array,
        }
    }

    /// An `i31ref` as an abbreviation for `(ref null i31)`.
    pub fn i31() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::I31,
        }
    }

    /// A `nullfuncref` as an abbreviation for `(ref null nofunc)`.
    pub fn nullfuncref() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::NoFunc,
        }
    }

    /// A `nullexternref` as an abbreviation for `(ref null noextern)`.
    pub fn nullexternref() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::NoExtern,
        }
    }

    /// A `nullref` as an abbreviation for `(ref null none)`.
    pub fn nullref() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::None,
        }
    }

    /// A `nullexnref` as an abbreviation for `(ref null noexn)`.
    pub fn nullexnref() -> Self {
        RefType {
            nullable: true,
            heap: HeapType::NoExn,
        }
    }
}

impl<'a> Parse<'a> for RefType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut l = parser.lookahead1();
        if l.peek::<kw::funcref>()? {
            parser.parse::<kw::funcref>()?;
            Ok(RefType::func())
        } else if l.peek::<kw::externref>()? {
            parser.parse::<kw::externref>()?;
            Ok(RefType::r#extern())
        } else if l.peek::<kw::exnref>()? {
            parser.parse::<kw::exnref>()?;
            Ok(RefType::exn())
        } else if l.peek::<kw::anyref>()? {
            parser.parse::<kw::anyref>()?;
            Ok(RefType::any())
        } else if l.peek::<kw::eqref>()? {
            parser.parse::<kw::eqref>()?;
            Ok(RefType::eq())
        } else if l.peek::<kw::structref>()? {
            parser.parse::<kw::structref>()?;
            Ok(RefType::r#struct())
        } else if l.peek::<kw::arrayref>()? {
            parser.parse::<kw::arrayref>()?;
            Ok(RefType::array())
        } else if l.peek::<kw::i31ref>()? {
            parser.parse::<kw::i31ref>()?;
            Ok(RefType::i31())
        } else if l.peek::<kw::nullfuncref>()? {
            parser.parse::<kw::nullfuncref>()?;
            Ok(RefType::nullfuncref())
        } else if l.peek::<kw::nullexternref>()? {
            parser.parse::<kw::nullexternref>()?;
            Ok(RefType::nullexternref())
        } else if l.peek::<kw::nullexnref>()? {
            parser.parse::<kw::nullexnref>()?;
            Ok(RefType::nullexnref())
        } else if l.peek::<kw::nullref>()? {
            parser.parse::<kw::nullref>()?;
            Ok(RefType::nullref())
        } else if l.peek::<LParen>()? {
            parser.parens(|p| {
                let mut l = parser.lookahead1();
                if l.peek::<kw::r#ref>()? {
                    p.parse::<kw::r#ref>()?;

                    let mut nullable = false;
                    if parser.peek::<kw::null>()? {
                        parser.parse::<kw::null>()?;
                        nullable = true;
                    }

                    Ok(RefType {
                        nullable,
                        heap: parser.parse()?,
                    })
                } else {
                    Err(l.error())
                }
            })
        } else {
            Err(l.error())
        }
    }
}

impl<'a> Peek for RefType<'a> {
    fn peek(cursor: Cursor<'_>) -> Result<bool> {
        Ok(kw::funcref::peek(cursor)?
            || kw::externref::peek(cursor)?
            || kw::exnref::peek(cursor)?
            || kw::anyref::peek(cursor)?
            || kw::eqref::peek(cursor)?
            || kw::structref::peek(cursor)?
            || kw::arrayref::peek(cursor)?
            || kw::i31ref::peek(cursor)?
            || kw::nullfuncref::peek(cursor)?
            || kw::nullexternref::peek(cursor)?
            || kw::nullexnref::peek(cursor)?
            || kw::nullref::peek(cursor)?
            || (LParen::peek(cursor)? && kw::r#ref::peek2(cursor)?))
    }
    fn display() -> &'static str {
        "reftype"
    }
}

/// The types of values that may be used in a struct or array.
#[allow(missing_docs)]
#[derive(Debug, PartialEq, Eq, Hash, Copy, Clone)]
pub enum StorageType<'a> {
    I8,
    I16,
    Val(ValType<'a>),
}

impl<'a> Parse<'a> for StorageType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut l = parser.lookahead1();
        if l.peek::<kw::i8>()? {
            parser.parse::<kw::i8>()?;
            Ok(StorageType::I8)
        } else if l.peek::<kw::i16>()? {
            parser.parse::<kw::i16>()?;
            Ok(StorageType::I16)
        } else if l.peek::<ValType>()? {
            Ok(StorageType::Val(parser.parse()?))
        } else {
            Err(l.error())
        }
    }
}

/// Type for a `global` in a wasm module
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct GlobalType<'a> {
    /// The element type of this `global`
    pub ty: ValType<'a>,
    /// Whether or not the global is mutable or not.
    pub mutable: bool,
    /// Whether or not the global is shared.
    pub shared: bool,
}

impl<'a> Parse<'a> for GlobalType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        if parser.peek2::<kw::shared>()? || parser.peek2::<kw::r#mut>()? {
            parser.parens(|p| {
                let mut shared = false;
                let mut mutable = false;
                if p.peek::<kw::shared>()? {
                    p.parse::<kw::shared>()?;
                    shared = true;
                }
                if p.peek::<kw::r#mut>()? {
                    p.parse::<kw::r#mut>()?;
                    mutable = true;
                }
                Ok(GlobalType {
                    ty: p.parse()?,
                    mutable,
                    shared,
                })
            })
        } else {
            Ok(GlobalType {
                ty: parser.parse()?,
                mutable: false,
                shared: false,
            })
        }
    }
}

/// Min/max limits used for tables/memories.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Limits {
    /// Whether or not these limits are for 64-bit tables/memories or not.
    pub is64: bool,
    /// The minimum number of units for this type.
    pub min: u64,
    /// An optional maximum number of units for this type.
    pub max: Option<u64>,
}

impl<'a> Parse<'a> for Limits {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let is64 = if parser.peek::<kw::i32>()? {
            parser.parse::<kw::i32>()?;
            false
        } else if parser.peek::<kw::i64>()? {
            parser.parse::<kw::i64>()?;
            true
        } else {
            false
        };

        let parse = || {
            if is64 {
                parser.parse::<u64>()
            } else {
                parser.parse::<u32>().map(|x| x.into())
            }
        };

        let min = parse()?;
        let max = if parser.peek::<u64>()? {
            Some(parse()?)
        } else {
            None
        };
        Ok(Limits { is64, min, max })
    }
}

/// Configuration for a table of a wasm mdoule
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct TableType<'a> {
    /// Limits on the element sizes of this table
    pub limits: Limits,
    /// The type of element stored in this table
    pub elem: RefType<'a>,
}

impl<'a> Parse<'a> for TableType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        Ok(TableType {
            limits: parser.parse()?,
            elem: parser.parse()?,
        })
    }
}

/// Configuration for a memory of a wasm module
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct MemoryType {
    /// Limits on the page sizes of this memory
    pub limits: Limits,
    /// Whether or not this is a shared (atomic) memory type
    pub shared: bool,
    /// The custom page size for this memory, if any.
    pub page_size_log2: Option<u32>,
}

fn page_size(parser: Parser<'_>) -> Result<Option<u32>> {
    if parser.peek::<LParen>()? {
        Ok(Some(parser.parens(|parser| {
            parser.parse::<kw::pagesize>()?;
            let span = parser.cur_span();
            let size = parser.parse::<u32>()?;
            if size.is_power_of_two() {
                Ok(size.ilog2())
            } else {
                Err(Error::new(
                    span,
                    format!("invalid custom page size: {size}"),
                ))
            }
        })?))
    } else {
        Ok(None)
    }
}

impl<'a> Parse<'a> for MemoryType {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let limits = parser.parse()?;
        let shared = parser.parse::<Option<kw::shared>>()?.is_some();
        let page_size = page_size(parser)?;
        Ok(MemoryType {
            limits,
            shared,
            page_size_log2: page_size,
        })
    }
}

/// A function type with parameters and results.
#[derive(Clone, Debug, Default)]
pub struct FunctionType<'a> {
    /// The parameters of a function, optionally each having an identifier for
    /// name resolution and a name for the custom `name` section.
    pub params: Box<[(Option<Id<'a>>, Option<NameAnnotation<'a>>, ValType<'a>)]>,
    /// The results types of a function.
    pub results: Box<[ValType<'a>]>,
}

impl<'a> FunctionType<'a> {
    fn finish_parse(&mut self, allow_names: bool, parser: Parser<'a>) -> Result<()> {
        let mut params = Vec::from(mem::take(&mut self.params));
        let mut results = Vec::from(mem::take(&mut self.results));
        while parser.peek2::<kw::param>()? || parser.peek2::<kw::result>()? {
            parser.parens(|p| {
                let mut l = p.lookahead1();
                if l.peek::<kw::param>()? {
                    if results.len() > 0 {
                        return Err(p.error(
                            "result before parameter (or unexpected token): \
                             cannot list params after results",
                        ));
                    }
                    p.parse::<kw::param>()?;
                    if p.is_empty() {
                        return Ok(());
                    }
                    let (id, name) = if allow_names {
                        (p.parse::<Option<_>>()?, p.parse::<Option<_>>()?)
                    } else {
                        (None, None)
                    };
                    let parse_more = id.is_none() && name.is_none();
                    let ty = p.parse()?;
                    params.push((id, name, ty));
                    while parse_more && !p.is_empty() {
                        params.push((None, None, p.parse()?));
                    }
                } else if l.peek::<kw::result>()? {
                    p.parse::<kw::result>()?;
                    while !p.is_empty() {
                        results.push(p.parse()?);
                    }
                } else {
                    return Err(l.error());
                }
                Ok(())
            })?;
        }
        self.params = params.into();
        self.results = results.into();
        Ok(())
    }
}

impl<'a> Parse<'a> for FunctionType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut ret = FunctionType {
            params: Box::new([]),
            results: Box::new([]),
        };
        ret.finish_parse(true, parser)?;
        Ok(ret)
    }
}

impl<'a> Peek for FunctionType<'a> {
    fn peek(cursor: Cursor<'_>) -> Result<bool> {
        if let Some(next) = cursor.lparen()? {
            match next.keyword()? {
                Some(("param", _)) | Some(("result", _)) => return Ok(true),
                _ => {}
            }
        }

        Ok(false)
    }

    fn display() -> &'static str {
        "function type"
    }
}

/// A function type with parameters and results.
#[derive(Clone, Debug, Default)]
pub struct FunctionTypeNoNames<'a>(pub FunctionType<'a>);

impl<'a> Parse<'a> for FunctionTypeNoNames<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut ret = FunctionType {
            params: Box::new([]),
            results: Box::new([]),
        };
        ret.finish_parse(false, parser)?;
        Ok(FunctionTypeNoNames(ret))
    }
}

impl<'a> Peek for FunctionTypeNoNames<'a> {
    fn peek(cursor: Cursor<'_>) -> Result<bool> {
        FunctionType::peek(cursor)
    }

    fn display() -> &'static str {
        FunctionType::display()
    }
}

impl<'a> From<FunctionTypeNoNames<'a>> for FunctionType<'a> {
    fn from(ty: FunctionTypeNoNames<'a>) -> FunctionType<'a> {
        ty.0
    }
}

/// A struct type with fields.
#[derive(Clone, Debug)]
pub struct StructType<'a> {
    /// The fields of the struct
    pub fields: Vec<StructField<'a>>,
}

impl<'a> Parse<'a> for StructType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut ret = StructType { fields: Vec::new() };
        while !parser.is_empty() {
            parser.parens(|parser| {
                parser.parse::<kw::field>()?;
                if parser.peek::<Id>()? {
                    let field = StructField::parse(parser, true);
                    ret.fields.push(field?);
                } else {
                    while !parser.is_empty() {
                        let field = StructField::parse(parser, false);
                        ret.fields.push(field?);
                    }
                }
                Ok(())
            })?;
        }
        Ok(ret)
    }
}

/// A field of a struct type.
#[derive(Clone, Debug)]
pub struct StructField<'a> {
    /// An optional identifier for name resolution.
    pub id: Option<Id<'a>>,
    /// Whether this field may be mutated or not.
    pub mutable: bool,
    /// The storage type stored in this field.
    pub ty: StorageType<'a>,
}

impl<'a> StructField<'a> {
    fn parse(parser: Parser<'a>, with_id: bool) -> Result<Self> {
        let id = if with_id { parser.parse()? } else { None };
        let (ty, mutable) = if parser.peek2::<kw::r#mut>()? {
            let ty = parser.parens(|parser| {
                parser.parse::<kw::r#mut>()?;
                parser.parse()
            })?;
            (ty, true)
        } else {
            (parser.parse::<StorageType<'a>>()?, false)
        };
        Ok(StructField { id, mutable, ty })
    }
}

/// An array type with fields.
#[derive(Clone, Debug)]
pub struct ArrayType<'a> {
    /// Whether this field may be mutated or not.
    pub mutable: bool,
    /// The storage type stored in this field.
    pub ty: StorageType<'a>,
}

impl<'a> Parse<'a> for ArrayType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let (ty, mutable) = if parser.peek2::<kw::r#mut>()? {
            let ty = parser.parens(|parser| {
                parser.parse::<kw::r#mut>()?;
                parser.parse()
            })?;
            (ty, true)
        } else {
            (parser.parse::<StorageType<'a>>()?, false)
        };
        Ok(ArrayType { mutable, ty })
    }
}

/// The type of an exported item from a module or instance.
#[derive(Debug, Clone)]
pub struct ExportType<'a> {
    /// Where this export was defined.
    pub span: Span,
    /// The name of this export.
    pub name: &'a str,
    /// The signature of the item that's exported.
    pub item: ItemSig<'a>,
}

impl<'a> Parse<'a> for ExportType<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let span = parser.parse::<kw::export>()?.0;
        let name = parser.parse()?;
        let item = parser.parens(|p| p.parse())?;
        Ok(ExportType { span, name, item })
    }
}

/// A definition of a type.
#[derive(Debug)]
pub enum TypeDef<'a> {
    /// A function type definition.
    Func(FunctionType<'a>),
    /// A struct type definition.
    Struct(StructType<'a>),
    /// An array type definition.
    Array(ArrayType<'a>),
}

impl<'a> Parse<'a> for TypeDef<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let mut l = parser.lookahead1();
        if l.peek::<kw::func>()? {
            parser.parse::<kw::func>()?;
            Ok(TypeDef::Func(parser.parse()?))
        } else if l.peek::<kw::r#struct>()? {
            parser.parse::<kw::r#struct>()?;
            Ok(TypeDef::Struct(parser.parse()?))
        } else if l.peek::<kw::array>()? {
            parser.parse::<kw::array>()?;
            Ok(TypeDef::Array(parser.parse()?))
        } else {
            Err(l.error())
        }
    }
}

/// A type declaration in a module
#[derive(Debug)]
pub struct Type<'a> {
    /// Where this type was defined.
    pub span: Span,
    /// An optional identifier to refer to this `type` by as part of name
    /// resolution.
    pub id: Option<Id<'a>>,
    /// An optional name for this function stored in the custom `name` section.
    pub name: Option<NameAnnotation<'a>>,
    /// The type that we're declaring.
    pub def: TypeDef<'a>,
    /// The declared parent type of this definition.
    pub parent: Option<Index<'a>>,
    /// Whether this type is final or not. By default types are final.
    pub final_type: Option<bool>,
}

impl<'a> Peek for Type<'a> {
    fn peek(cursor: Cursor<'_>) -> Result<bool> {
        kw::r#type::peek(cursor)
    }
    fn display() -> &'static str {
        "type"
    }
}

impl<'a> Parse<'a> for Type<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let span = parser.parse::<kw::r#type>()?.0;
        let id = parser.parse()?;
        let name = parser.parse()?;

        let (parent, def, final_type) = if parser.peek2::<kw::sub>()? {
            parser.parens(|parser| {
                parser.parse::<kw::sub>()?;

                let final_type: Option<bool> = if parser.peek::<kw::r#final>()? {
                    parser.parse::<kw::r#final>()?;
                    Some(true)
                } else {
                    Some(false)
                };

                let parent = if parser.peek::<Index<'a>>()? {
                    parser.parse()?
                } else {
                    None
                };
                let def = parser.parens(|parser| parser.parse())?;
                Ok((parent, def, final_type))
            })?
        } else {
            (None, parser.parens(|parser| parser.parse())?, None)
        };

        Ok(Type {
            span,
            id,
            name,
            def,
            parent,
            final_type,
        })
    }
}

/// A recursion group declaration in a module
#[derive(Debug)]
pub struct Rec<'a> {
    /// Where this recursion group was defined.
    pub span: Span,
    /// The types that we're defining in this group.
    pub types: Vec<Type<'a>>,
}

impl<'a> Parse<'a> for Rec<'a> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let span = parser.parse::<kw::r#rec>()?.0;
        let mut types = Vec::new();
        while parser.peek2::<Type<'a>>()? {
            types.push(parser.parens(|p| p.parse())?);
        }
        Ok(Rec { span, types })
    }
}

/// A reference to a type defined in this module.
#[derive(Clone, Debug)]
pub struct TypeUse<'a, T> {
    /// The type that we're referencing, if it was present.
    pub index: Option<Index<'a>>,
    /// The inline type, if present.
    pub inline: Option<T>,
}

impl<'a, T> TypeUse<'a, T> {
    /// Constructs a new instance of `TypeUse` without an inline definition but
    /// with an index specified.
    pub fn new_with_index(idx: Index<'a>) -> TypeUse<'a, T> {
        TypeUse {
            index: Some(idx),
            inline: None,
        }
    }
}

impl<'a, T: Peek + Parse<'a>> Parse<'a> for TypeUse<'a, T> {
    fn parse(parser: Parser<'a>) -> Result<Self> {
        let index = if parser.peek2::<kw::r#type>()? {
            Some(parser.parens(|p| {
                p.parse::<kw::r#type>()?;
                p.parse()
            })?)
        } else {
            None
        };
        let inline = parser.parse()?;

        Ok(TypeUse { index, inline })
    }
}

impl<'a> From<TypeUse<'a, FunctionTypeNoNames<'a>>> for TypeUse<'a, FunctionType<'a>> {
    fn from(src: TypeUse<'a, FunctionTypeNoNames<'a>>) -> TypeUse<'a, FunctionType<'a>> {
        TypeUse {
            index: src.index,
            inline: src.inline.map(|x| x.into()),
        }
    }
}
