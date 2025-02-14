// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

#![allow(clippy::module_name_repetitions)]

// Encoding and decoding packets off the wire.
use std::{
    cmp::min,
    fmt,
    ops::{Deref, DerefMut, Range},
    time::Instant,
};

use neqo_common::{hex, hex_with_len, qtrace, qwarn, Decoder, Encoder};
use neqo_crypto::random;

use crate::{
    cid::{ConnectionId, ConnectionIdDecoder, ConnectionIdRef, MAX_CONNECTION_ID_LEN},
    crypto::{CryptoDxState, CryptoSpace, CryptoStates},
    frame::FRAME_TYPE_PADDING,
    recovery::SendProfile,
    version::{Version, WireVersion},
    Error, Pmtud, Res,
};

/// `MIN_INITIAL_PACKET_SIZE` is the smallest packet that can be used to establish
/// a new connection across all QUIC versions this server supports.
pub const MIN_INITIAL_PACKET_SIZE: usize = 1200;

pub const PACKET_BIT_LONG: u8 = 0x80;
const PACKET_BIT_SHORT: u8 = 0x00;
const PACKET_BIT_FIXED_QUIC: u8 = 0x40;
const PACKET_BIT_SPIN: u8 = 0x20;
const PACKET_BIT_KEY_PHASE: u8 = 0x04;

const PACKET_HP_MASK_LONG: u8 = 0x0f;
const PACKET_HP_MASK_SHORT: u8 = 0x1f;

const SAMPLE_SIZE: usize = 16;
const SAMPLE_OFFSET: usize = 4;
const MAX_PACKET_NUMBER_LEN: usize = 4;

mod retry;

pub type PacketNumber = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketType {
    VersionNegotiation,
    Initial,
    Handshake,
    ZeroRtt,
    Retry,
    Short,
    OtherVersion,
}

impl PacketType {
    #[must_use]
    fn from_byte(t: u8, v: Version) -> Self {
        // Version2 adds one to the type, modulo 4
        match t.wrapping_sub(u8::from(v == Version::Version2)) & 3 {
            0 => Self::Initial,
            1 => Self::ZeroRtt,
            2 => Self::Handshake,
            3 => Self::Retry,
            _ => panic!("packet type out of range"),
        }
    }

    #[must_use]
    fn to_byte(self, v: Version) -> u8 {
        let t = match self {
            Self::Initial => 0,
            Self::ZeroRtt => 1,
            Self::Handshake => 2,
            Self::Retry => 3,
            _ => panic!("not a long header packet type"),
        };
        // Version2 adds one to the type, modulo 4
        (t + u8::from(v == Version::Version2)) & 3
    }
}

#[allow(clippy::fallible_impl_from)]
impl From<PacketType> for CryptoSpace {
    fn from(v: PacketType) -> Self {
        match v {
            PacketType::Initial => Self::Initial,
            PacketType::ZeroRtt => Self::ZeroRtt,
            PacketType::Handshake => Self::Handshake,
            PacketType::Short => Self::ApplicationData,
            _ => panic!("shouldn't be here"),
        }
    }
}

impl From<CryptoSpace> for PacketType {
    fn from(cs: CryptoSpace) -> Self {
        match cs {
            CryptoSpace::Initial => Self::Initial,
            CryptoSpace::ZeroRtt => Self::ZeroRtt,
            CryptoSpace::Handshake => Self::Handshake,
            CryptoSpace::ApplicationData => Self::Short,
        }
    }
}

struct PacketBuilderOffsets {
    /// The bits of the first octet that need masking.
    first_byte_mask: u8,
    /// The offset of the length field.
    len: usize,
    /// The location of the packet number field.
    pn: Range<usize>,
}

/// A packet builder that can be used to produce short packets and long packets.
/// This does not produce Retry or Version Negotiation.
pub struct PacketBuilder {
    encoder: Encoder,
    pn: PacketNumber,
    header: Range<usize>,
    offsets: PacketBuilderOffsets,
    limit: usize,
    /// Whether to pad the packet before construction.
    padding: bool,
}

impl PacketBuilder {
    /// The minimum useful frame size.  If space is less than this, we will claim to be full.
    pub const MINIMUM_FRAME_SIZE: usize = 2;

    fn infer_limit(encoder: &Encoder) -> usize {
        if encoder.capacity() > 64 {
            encoder.capacity()
        } else {
            2048
        }
    }

    /// Start building a short header packet.
    ///
    /// This doesn't fail if there isn't enough space; instead it returns a builder that
    /// has no available space left.  This allows the caller to extract the encoder
    /// and any packets that might have been added before as adding a packet header is
    /// only likely to fail if there are other packets already written.
    ///
    /// If, after calling this method, `remaining()` returns 0, then call `abort()` to get
    /// the encoder back.
    pub fn short(mut encoder: Encoder, key_phase: bool, dcid: Option<impl AsRef<[u8]>>) -> Self {
        let mut limit = Self::infer_limit(&encoder);
        let header_start = encoder.len();
        // Check that there is enough space for the header.
        // 5 = 1 (first byte) + 4 (packet number)
        if limit > encoder.len()
            && 5 + dcid.as_ref().map_or(0, |d| d.as_ref().len()) < limit - encoder.len()
        {
            encoder
                .encode_byte(PACKET_BIT_SHORT | PACKET_BIT_FIXED_QUIC | (u8::from(key_phase) << 2));
            if let Some(dcid) = dcid {
                encoder.encode(dcid.as_ref());
            }
        } else {
            limit = 0;
        }
        Self {
            encoder,
            pn: u64::MAX,
            header: header_start..header_start,
            offsets: PacketBuilderOffsets {
                first_byte_mask: PACKET_HP_MASK_SHORT,
                pn: 0..0,
                len: 0,
            },
            limit,
            padding: false,
        }
    }

    /// Start building a long header packet.
    /// For an Initial packet you will need to call `initial_token()`,
    /// even if the token is empty.
    ///
    /// See `short()` for more on how to handle this in cases where there is no space.
    #[allow(clippy::similar_names)]
    pub fn long(
        mut encoder: Encoder,
        pt: PacketType,
        version: Version,
        mut dcid: Option<impl AsRef<[u8]>>,
        mut scid: Option<impl AsRef<[u8]>>,
    ) -> Self {
        let mut limit = Self::infer_limit(&encoder);
        let header_start = encoder.len();
        // Check that there is enough space for the header.
        // 11 = 1 (first byte) + 4 (version) + 2 (dcid+scid length) + 4 (packet number)
        if limit > encoder.len()
            && 11
                + dcid.as_ref().map_or(0, |d| d.as_ref().len())
                + scid.as_ref().map_or(0, |d| d.as_ref().len())
                < limit - encoder.len()
        {
            encoder
                .encode_byte(PACKET_BIT_LONG | PACKET_BIT_FIXED_QUIC | (pt.to_byte(version) << 4));
            encoder.encode_uint(4, version.wire_version());
            encoder.encode_vec(1, dcid.take().as_ref().map_or(&[], AsRef::as_ref));
            encoder.encode_vec(1, scid.take().as_ref().map_or(&[], AsRef::as_ref));
        } else {
            limit = 0;
        }

        Self {
            encoder,
            pn: u64::MAX,
            header: header_start..header_start,
            offsets: PacketBuilderOffsets {
                first_byte_mask: PACKET_HP_MASK_LONG,
                pn: 0..0,
                len: 0,
            },
            limit,
            padding: false,
        }
    }

    fn is_long(&self) -> bool {
        self.as_ref()[self.header.start] & 0x80 == PACKET_BIT_LONG
    }

    /// This stores a value that can be used as a limit.  This does not cause
    /// this limit to be enforced until encryption occurs.  Prior to that, it
    /// is only used voluntarily by users of the builder, through `remaining()`.
    pub fn set_limit(&mut self, limit: usize) {
        self.limit = limit;
    }

    /// Set the initial limit for the packet, based on the profile and the PMTUD state.
    /// Returns true if the packet needs padding.
    pub fn set_initial_limit(
        &mut self,
        profile: &SendProfile,
        aead_expansion: usize,
        pmtud: &Pmtud,
    ) -> bool {
        if pmtud.needs_probe() {
            debug_assert!(pmtud.probe_size() > profile.limit());
            self.limit = pmtud.probe_size() - aead_expansion;
            true
        } else {
            self.limit = profile.limit() - aead_expansion;
            false
        }
    }

    /// Get the current limit.
    #[must_use]
    pub const fn limit(&self) -> usize {
        self.limit
    }

    /// How many bytes remain against the size limit for the builder.
    #[must_use]
    pub fn remaining(&self) -> usize {
        self.limit.saturating_sub(self.encoder.len())
    }

    /// Returns true if the packet has no more space for frames.
    #[must_use]
    pub fn is_full(&self) -> bool {
        // No useful frame is smaller than 2 bytes long.
        self.limit < self.encoder.len() + Self::MINIMUM_FRAME_SIZE
    }

    /// Adjust the limit to ensure that no more data is added.
    pub fn mark_full(&mut self) {
        self.limit = self.encoder.len();
    }

    /// Mark the packet as needing padding (or not).
    pub fn enable_padding(&mut self, needs_padding: bool) {
        self.padding = needs_padding;
    }

    /// Maybe pad with "PADDING" frames.
    /// Only does so if padding was needed and this is a short packet.
    /// Returns true if padding was added.
    ///
    /// # Panics
    ///
    /// Cannot happen.
    pub fn pad(&mut self) -> bool {
        if self.padding && !self.is_long() {
            self.encoder
                .pad_to(self.limit, FRAME_TYPE_PADDING.try_into().unwrap());
            true
        } else {
            false
        }
    }

    /// Add unpredictable values for unprotected parts of the packet.
    pub fn scramble(&mut self, quic_bit: bool) {
        debug_assert!(self.len() > self.header.start);
        let mask = if quic_bit { PACKET_BIT_FIXED_QUIC } else { 0 }
            | if self.is_long() { 0 } else { PACKET_BIT_SPIN };
        let first = self.header.start;
        self.encoder.as_mut()[first] ^= random::<1>()[0] & mask;
    }

    /// For an Initial packet, encode the token.
    /// If you fail to do this, then you will not get a valid packet.
    pub fn initial_token(&mut self, token: &[u8]) {
        if Encoder::vvec_len(token.len()) < self.remaining() {
            self.encoder.encode_vvec(token);
        } else {
            self.limit = 0;
        }
    }

    /// Add a packet number of the given size.
    /// For a long header packet, this also inserts a dummy length.
    /// The length is filled in after calling `build`.
    /// Does nothing if there isn't 4 bytes available other than render this builder
    /// unusable; if `remaining()` returns 0 at any point, call `abort()`.
    ///
    /// # Panics
    ///
    /// This will panic if the packet number length is too large.
    pub fn pn(&mut self, pn: PacketNumber, pn_len: usize) {
        if self.remaining() < 4 {
            self.limit = 0;
            return;
        }

        // Reserve space for a length in long headers.
        if self.is_long() {
            self.offsets.len = self.encoder.len();
            self.encoder.encode(&[0; 2]);
        }

        // This allows the input to be >4, which is absurd, but we can eat that.
        let pn_len = min(MAX_PACKET_NUMBER_LEN, pn_len);
        debug_assert_ne!(pn_len, 0);
        // Encode the packet number and save its offset.
        let pn_offset = self.encoder.len();
        self.encoder.encode_uint(pn_len, pn);
        self.offsets.pn = pn_offset..self.encoder.len();

        // Now encode the packet number length and save the header length.
        self.encoder.as_mut()[self.header.start] |= u8::try_from(pn_len - 1).unwrap();
        self.header.end = self.encoder.len();
        self.pn = pn;
    }

    #[allow(clippy::cast_possible_truncation)] // Nope.
    fn write_len(&mut self, expansion: usize) {
        let len = self.encoder.len() - (self.offsets.len + 2) + expansion;
        self.encoder.as_mut()[self.offsets.len] = 0x40 | ((len >> 8) & 0x3f) as u8;
        self.encoder.as_mut()[self.offsets.len + 1] = (len & 0xff) as u8;
    }

    fn pad_for_crypto(&mut self, crypto: &CryptoDxState) {
        // Make sure that there is enough data in the packet.
        // The length of the packet number plus the payload length needs to
        // be at least 4 (MAX_PACKET_NUMBER_LEN) plus any amount by which
        // the header protection sample exceeds the AEAD expansion.
        let crypto_pad = crypto.extra_padding();
        self.encoder.pad_to(
            self.offsets.pn.start + MAX_PACKET_NUMBER_LEN + crypto_pad,
            0,
        );
    }

    /// A lot of frames here are just a collection of varints.
    /// This helper functions writes a frame like that safely, returning `true` if
    /// a frame was written.
    pub fn write_varint_frame(&mut self, values: &[u64]) -> bool {
        let write = self.remaining()
            >= values
                .iter()
                .map(|&v| Encoder::varint_len(v))
                .sum::<usize>();
        if write {
            for v in values {
                self.encode_varint(*v);
            }
            debug_assert!(self.len() <= self.limit());
        };
        write
    }

    /// Build the packet and return the encoder.
    ///
    /// # Errors
    ///
    /// This will return an error if the packet is too large.
    pub fn build(mut self, crypto: &mut CryptoDxState) -> Res<Encoder> {
        if self.len() > self.limit {
            qwarn!("Packet contents are more than the limit");
            debug_assert!(false);
            return Err(Error::InternalError);
        }

        self.pad_for_crypto(crypto);
        if self.offsets.len > 0 {
            self.write_len(crypto.expansion());
        }

        let hdr = &self.encoder.as_ref()[self.header.clone()];
        let body = &self.encoder.as_ref()[self.header.end..];
        qtrace!(
            "Packet build pn={} hdr={} body={}",
            self.pn,
            hex(hdr),
            hex(body)
        );
        let ciphertext = crypto.encrypt(self.pn, hdr, body)?;

        // Calculate the mask.
        let offset = SAMPLE_OFFSET - self.offsets.pn.len();
        if offset + SAMPLE_SIZE > ciphertext.len() {
            return Err(Error::InternalError);
        }
        let sample = &ciphertext[offset..offset + SAMPLE_SIZE];
        let mask = crypto.compute_mask(sample)?;

        // Apply the mask.
        self.encoder.as_mut()[self.header.start] ^= mask[0] & self.offsets.first_byte_mask;
        for (i, j) in (1..=self.offsets.pn.len()).zip(self.offsets.pn) {
            self.encoder.as_mut()[j] ^= mask[i];
        }

        // Finally, cut off the plaintext and add back the ciphertext.
        self.encoder.truncate(self.header.end);
        self.encoder.encode(&ciphertext);
        qtrace!("Packet built {}", hex(&self.encoder));
        Ok(self.encoder)
    }

    /// Abort writing of this packet and return the encoder.
    #[must_use]
    pub fn abort(mut self) -> Encoder {
        self.encoder.truncate(self.header.start);
        self.encoder
    }

    /// Work out if nothing was added after the header.
    #[must_use]
    pub fn packet_empty(&self) -> bool {
        self.encoder.len() == self.header.end
    }

    /// Make a retry packet.
    /// As this is a simple packet, this is just an associated function.
    /// As Retry is odd (it has to be constructed with leading bytes),
    /// this returns a [`Vec<u8>`] rather than building on an encoder.
    ///
    /// # Errors
    ///
    /// This will return an error if AEAD encrypt fails.
    #[allow(clippy::similar_names)]
    pub fn retry(
        version: Version,
        dcid: &[u8],
        scid: &[u8],
        token: &[u8],
        odcid: &[u8],
    ) -> Res<Vec<u8>> {
        let mut encoder = Encoder::default();
        encoder.encode_vec(1, odcid);
        let start = encoder.len();
        encoder.encode_byte(
            PACKET_BIT_LONG
                | PACKET_BIT_FIXED_QUIC
                | (PacketType::Retry.to_byte(version) << 4)
                | (random::<1>()[0] & 0xf),
        );
        encoder.encode_uint(4, version.wire_version());
        encoder.encode_vec(1, dcid);
        encoder.encode_vec(1, scid);
        debug_assert_ne!(token.len(), 0);
        encoder.encode(token);
        let tag = retry::use_aead(version, |aead| {
            let mut buf = vec![0; aead.expansion()];
            Ok(aead.encrypt(0, encoder.as_ref(), &[], &mut buf)?.to_vec())
        })?;
        encoder.encode(&tag);
        let mut complete: Vec<u8> = encoder.into();
        Ok(complete.split_off(start))
    }

    /// Make a Version Negotiation packet.
    #[must_use]
    #[allow(clippy::similar_names)]
    pub fn version_negotiation(
        dcid: &[u8],
        scid: &[u8],
        client_version: u32,
        versions: &[Version],
    ) -> Vec<u8> {
        let mut encoder = Encoder::default();
        let mut grease = random::<4>();
        // This will not include the "QUIC bit" sometimes.  Intentionally.
        encoder.encode_byte(PACKET_BIT_LONG | (grease[3] & 0x7f));
        encoder.encode(&[0; 4]); // Zero version == VN.
        encoder.encode_vec(1, dcid);
        encoder.encode_vec(1, scid);

        for v in versions {
            encoder.encode_uint(4, v.wire_version());
        }
        // Add a greased version, using the randomness already generated.
        for g in &mut grease[..3] {
            *g = *g & 0xf0 | 0x0a;
        }

        // Ensure our greased version does not collide with the client version
        // by making the last byte differ from the client initial.
        grease[3] = (client_version.wrapping_add(0x10) & 0xf0) as u8 | 0x0a;
        encoder.encode(&grease[..4]);

        Vec::from(encoder)
    }
}

impl Deref for PacketBuilder {
    type Target = Encoder;

    fn deref(&self) -> &Self::Target {
        &self.encoder
    }
}

impl DerefMut for PacketBuilder {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.encoder
    }
}

impl From<PacketBuilder> for Encoder {
    fn from(v: PacketBuilder) -> Self {
        v.encoder
    }
}

/// `PublicPacket` holds information from packets that is public only.  This allows for
/// processing of packets prior to decryption.
pub struct PublicPacket<'a> {
    /// The packet type.
    packet_type: PacketType,
    /// The recovered destination connection ID.
    dcid: ConnectionIdRef<'a>,
    /// The source connection ID, if this is a long header packet.
    scid: Option<ConnectionIdRef<'a>>,
    /// Any token that is included in the packet (Retry always has a token; Initial sometimes
    /// does). This is empty when there is no token.
    token: &'a [u8],
    /// The size of the header, not including the packet number.
    header_len: usize,
    /// Protocol version, if present in header.
    version: Option<WireVersion>,
    /// A reference to the entire packet, including the header.
    data: &'a [u8],
}

impl<'a> PublicPacket<'a> {
    fn opt<T>(v: Option<T>) -> Res<T> {
        v.map_or_else(|| Err(Error::NoMoreData), |v| Ok(v))
    }

    /// Decode the type-specific portions of a long header.
    /// This includes reading the length and the remainder of the packet.
    /// Returns a tuple of any token and the length of the header.
    fn decode_long(
        decoder: &mut Decoder<'a>,
        packet_type: PacketType,
        version: Version,
    ) -> Res<(&'a [u8], usize)> {
        if packet_type == PacketType::Retry {
            let header_len = decoder.offset();
            let expansion = retry::expansion(version);
            let token = decoder
                .remaining()
                .checked_sub(expansion)
                .map_or(Err(Error::InvalidPacket), |v| Self::opt(decoder.decode(v)))?;
            if token.is_empty() {
                return Err(Error::InvalidPacket);
            }
            Self::opt(decoder.decode(expansion))?;
            return Ok((token, header_len));
        }
        let token = if packet_type == PacketType::Initial {
            Self::opt(decoder.decode_vvec())?
        } else {
            &[]
        };
        let len = Self::opt(decoder.decode_varint())?;
        let header_len = decoder.offset();
        let _body = Self::opt(decoder.decode(usize::try_from(len)?))?;
        Ok((token, header_len))
    }

    /// Decode the common parts of a packet.  This provides minimal parsing and validation.
    /// Returns a tuple of a `PublicPacket` and a slice with any remainder from the datagram.
    ///
    /// # Errors
    ///
    /// This will return an error if the packet could not be decoded.
    #[allow(clippy::similar_names)]
    pub fn decode(data: &'a [u8], dcid_decoder: &dyn ConnectionIdDecoder) -> Res<(Self, &'a [u8])> {
        let mut decoder = Decoder::new(data);
        let first = Self::opt(decoder.decode_uint::<u8>())?;

        if first & 0x80 == PACKET_BIT_SHORT {
            // Conveniently, this also guarantees that there is enough space
            // for a connection ID of any size.
            if decoder.remaining() < SAMPLE_OFFSET + SAMPLE_SIZE {
                return Err(Error::InvalidPacket);
            }
            let dcid = Self::opt(dcid_decoder.decode_cid(&mut decoder))?;
            if decoder.remaining() < SAMPLE_OFFSET + SAMPLE_SIZE {
                return Err(Error::InvalidPacket);
            }
            let header_len = decoder.offset();
            return Ok((
                Self {
                    packet_type: PacketType::Short,
                    dcid,
                    scid: None,
                    token: &[],
                    header_len,
                    version: None,
                    data,
                },
                &[],
            ));
        }

        // Generic long header.
        let version = Self::opt(decoder.decode_uint())?;
        let dcid = ConnectionIdRef::from(Self::opt(decoder.decode_vec(1))?);
        let scid = ConnectionIdRef::from(Self::opt(decoder.decode_vec(1))?);

        // Version negotiation.
        if version == 0 {
            return Ok((
                Self {
                    packet_type: PacketType::VersionNegotiation,
                    dcid,
                    scid: Some(scid),
                    token: &[],
                    header_len: decoder.offset(),
                    version: None,
                    data,
                },
                &[],
            ));
        }

        // Check that this is a long header from a supported version.
        let Ok(version) = Version::try_from(version) else {
            return Ok((
                Self {
                    packet_type: PacketType::OtherVersion,
                    dcid,
                    scid: Some(scid),
                    token: &[],
                    header_len: decoder.offset(),
                    version: Some(version),
                    data,
                },
                &[],
            ));
        };

        if dcid.len() > MAX_CONNECTION_ID_LEN || scid.len() > MAX_CONNECTION_ID_LEN {
            return Err(Error::InvalidPacket);
        }
        let packet_type = PacketType::from_byte((first >> 4) & 3, version);

        // The type-specific code includes a token.  This consumes the remainder of the packet.
        let (token, header_len) = Self::decode_long(&mut decoder, packet_type, version)?;
        let end = data.len() - decoder.remaining();
        let (data, remainder) = data.split_at(end);
        Ok((
            Self {
                packet_type,
                dcid,
                scid: Some(scid),
                token,
                header_len,
                version: Some(version.wire_version()),
                data,
            },
            remainder,
        ))
    }

    /// Validate the given packet as though it were a retry.
    #[must_use]
    pub fn is_valid_retry(&self, odcid: &ConnectionId) -> bool {
        if self.packet_type != PacketType::Retry {
            return false;
        }
        let Some(version) = self.version() else {
            return false;
        };
        let expansion = retry::expansion(version);
        if self.data.len() <= expansion {
            return false;
        }
        let (header, tag) = self.data.split_at(self.data.len() - expansion);
        let mut encoder = Encoder::with_capacity(self.data.len());
        encoder.encode_vec(1, odcid);
        encoder.encode(header);
        retry::use_aead(version, |aead| {
            let mut buf = vec![0; expansion];
            Ok(aead.decrypt(0, encoder.as_ref(), tag, &mut buf)?.is_empty())
        })
        .unwrap_or(false)
    }

    #[must_use]
    pub fn is_valid_initial(&self) -> bool {
        // Packet has to be an initial, with a DCID of 8 bytes, or a token.
        // Note: the Server class validates the token and checks the length.
        self.packet_type == PacketType::Initial
            && (self.dcid().len() >= 8 || !self.token.is_empty())
    }

    #[must_use]
    pub const fn packet_type(&self) -> PacketType {
        self.packet_type
    }

    #[must_use]
    pub const fn dcid(&self) -> ConnectionIdRef<'a> {
        self.dcid
    }

    /// # Panics
    ///
    /// This will panic if called for a short header packet.
    #[must_use]
    pub fn scid(&self) -> ConnectionIdRef<'a> {
        self.scid
            .expect("should only be called for long header packets")
    }

    #[must_use]
    pub const fn token(&self) -> &'a [u8] {
        self.token
    }

    #[must_use]
    pub fn version(&self) -> Option<Version> {
        self.version.and_then(|v| Version::try_from(v).ok())
    }

    #[must_use]
    pub fn wire_version(&self) -> WireVersion {
        debug_assert!(self.version.is_some());
        self.version.unwrap_or(0)
    }

    #[allow(clippy::len_without_is_empty)]
    #[must_use]
    pub const fn len(&self) -> usize {
        self.data.len()
    }

    const fn decode_pn(expected: PacketNumber, pn: u64, w: usize) -> PacketNumber {
        let window = 1_u64 << (w * 8);
        let candidate = (expected & !(window - 1)) | pn;
        if candidate + (window / 2) <= expected {
            candidate + window
        } else if candidate > expected + (window / 2) {
            match candidate.checked_sub(window) {
                Some(pn_sub) => pn_sub,
                None => candidate,
            }
        } else {
            candidate
        }
    }

    /// Decrypt the header of the packet.
    fn decrypt_header(
        &self,
        crypto: &CryptoDxState,
    ) -> Res<(bool, PacketNumber, Vec<u8>, &'a [u8])> {
        assert_ne!(self.packet_type, PacketType::Retry);
        assert_ne!(self.packet_type, PacketType::VersionNegotiation);

        let sample_offset = self.header_len + SAMPLE_OFFSET;
        let mask = self
            .data
            .get(sample_offset..(sample_offset + SAMPLE_SIZE))
            .map_or(Err(Error::NoMoreData), |sample| {
                qtrace!("unmask hdr={}", hex(&self.data[..sample_offset]));
                crypto.compute_mask(sample)
            })?;

        // Un-mask the leading byte.
        let bits = if self.packet_type == PacketType::Short {
            PACKET_HP_MASK_SHORT
        } else {
            PACKET_HP_MASK_LONG
        };
        let first_byte = self.data[0] ^ (mask[0] & bits);

        // Make a copy of the header to work on.
        let mut hdrbytes = self.data[..self.header_len + 4].to_vec();
        hdrbytes[0] = first_byte;

        // Unmask the PN.
        let mut pn_encoded: u64 = 0;
        for i in 0..MAX_PACKET_NUMBER_LEN {
            hdrbytes[self.header_len + i] ^= mask[1 + i];
            pn_encoded <<= 8;
            pn_encoded += u64::from(hdrbytes[self.header_len + i]);
        }

        // Now decode the packet number length and apply it, hopefully in constant time.
        let pn_len = usize::from((first_byte & 0x3) + 1);
        hdrbytes.truncate(self.header_len + pn_len);
        pn_encoded >>= 8 * (MAX_PACKET_NUMBER_LEN - pn_len);

        qtrace!("unmasked hdr={}", hex(&hdrbytes));

        let key_phase = self.packet_type == PacketType::Short
            && (first_byte & PACKET_BIT_KEY_PHASE) == PACKET_BIT_KEY_PHASE;
        let pn = Self::decode_pn(crypto.next_pn(), pn_encoded, pn_len);
        Ok((
            key_phase,
            pn,
            hdrbytes,
            &self.data[self.header_len + pn_len..],
        ))
    }

    /// # Errors
    ///
    /// This will return an error if the packet cannot be decrypted.
    pub fn decrypt(&self, crypto: &mut CryptoStates, release_at: Instant) -> Res<DecryptedPacket> {
        let cspace: CryptoSpace = self.packet_type.into();
        // When we don't have a version, the crypto code doesn't need a version
        // for lookup, so use the default, but fix it up if decryption succeeds.
        let version = self.version().unwrap_or_default();
        // This has to work in two stages because we need to remove header protection
        // before picking the keys to use.
        if let Some(rx) = crypto.rx_hp(version, cspace) {
            // Note that this will dump early, which creates a side-channel.
            // This is OK in this case because we the only reason this can
            // fail is if the cryptographic module is bad or the packet is
            // too small (which is public information).
            let (key_phase, pn, header, body) = self.decrypt_header(rx)?;
            qtrace!("[{rx}] decoded header: {header:?}");
            let Some(rx) = crypto.rx(version, cspace, key_phase) else {
                return Err(Error::DecryptError);
            };
            let version = rx.version(); // Version fixup; see above.
            let d = rx.decrypt(pn, &header, body)?;
            // If this is the first packet ever successfully decrypted
            // using `rx`, make sure to initiate a key update.
            if rx.needs_update() {
                crypto.key_update_received(release_at)?;
            }
            crypto.check_pn_overlap()?;
            Ok(DecryptedPacket {
                version,
                pt: self.packet_type,
                pn,
                data: d,
            })
        } else if crypto.rx_pending(cspace) {
            Err(Error::KeysPending(cspace))
        } else {
            qtrace!("keys for {cspace:?} already discarded");
            Err(Error::KeysDiscarded(cspace))
        }
    }

    /// # Errors
    ///
    /// This will return an error if the packet is not a version negotiation packet
    /// or if the versions cannot be decoded.
    pub fn supported_versions(&self) -> Res<Vec<WireVersion>> {
        if self.packet_type != PacketType::VersionNegotiation {
            return Err(Error::InvalidPacket);
        }
        let mut decoder = Decoder::new(&self.data[self.header_len..]);
        let mut res = Vec::new();
        while decoder.remaining() > 0 {
            let version = Self::opt(decoder.decode_uint::<WireVersion>())?;
            res.push(version);
        }
        Ok(res)
    }
}

impl fmt::Debug for PublicPacket<'_> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(
            f,
            "{:?}: {} {}",
            self.packet_type(),
            hex_with_len(&self.data[..self.header_len]),
            hex_with_len(&self.data[self.header_len..])
        )
    }
}

pub struct DecryptedPacket {
    version: Version,
    pt: PacketType,
    pn: PacketNumber,
    data: Vec<u8>,
}

impl DecryptedPacket {
    #[must_use]
    pub const fn version(&self) -> Version {
        self.version
    }

    #[must_use]
    pub const fn packet_type(&self) -> PacketType {
        self.pt
    }

    #[must_use]
    pub const fn pn(&self) -> PacketNumber {
        self.pn
    }
}

impl Deref for DecryptedPacket {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.data[..]
    }
}

#[cfg(all(test, not(feature = "disable-encryption")))]
mod tests {
    use neqo_common::Encoder;
    use test_fixture::{fixture_init, now};

    use crate::{
        cid::MAX_CONNECTION_ID_LEN,
        crypto::{CryptoDxState, CryptoStates},
        packet::{
            PacketBuilder, PacketType, PublicPacket, PACKET_BIT_FIXED_QUIC, PACKET_BIT_LONG,
            PACKET_BIT_SPIN,
        },
        ConnectionId, EmptyConnectionIdGenerator, RandomConnectionIdGenerator, Version,
    };

    const CLIENT_CID: &[u8] = &[0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08];
    const SERVER_CID: &[u8] = &[0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5];

    /// This is a connection ID manager, which is only used for decoding short header packets.
    const fn cid_mgr() -> RandomConnectionIdGenerator {
        RandomConnectionIdGenerator::new(SERVER_CID.len())
    }

    const SAMPLE_INITIAL_PAYLOAD: &[u8] = &[
        0x02, 0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x40, 0x5a, 0x02, 0x00, 0x00, 0x56, 0x03, 0x03,
        0xee, 0xfc, 0xe7, 0xf7, 0xb3, 0x7b, 0xa1, 0xd1, 0x63, 0x2e, 0x96, 0x67, 0x78, 0x25, 0xdd,
        0xf7, 0x39, 0x88, 0xcf, 0xc7, 0x98, 0x25, 0xdf, 0x56, 0x6d, 0xc5, 0x43, 0x0b, 0x9a, 0x04,
        0x5a, 0x12, 0x00, 0x13, 0x01, 0x00, 0x00, 0x2e, 0x00, 0x33, 0x00, 0x24, 0x00, 0x1d, 0x00,
        0x20, 0x9d, 0x3c, 0x94, 0x0d, 0x89, 0x69, 0x0b, 0x84, 0xd0, 0x8a, 0x60, 0x99, 0x3c, 0x14,
        0x4e, 0xca, 0x68, 0x4d, 0x10, 0x81, 0x28, 0x7c, 0x83, 0x4d, 0x53, 0x11, 0xbc, 0xf3, 0x2b,
        0xb9, 0xda, 0x1a, 0x00, 0x2b, 0x00, 0x02, 0x03, 0x04,
    ];
    const SAMPLE_INITIAL: &[u8] = &[
        0xcf, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5,
        0x00, 0x40, 0x75, 0xc0, 0xd9, 0x5a, 0x48, 0x2c, 0xd0, 0x99, 0x1c, 0xd2, 0x5b, 0x0a, 0xac,
        0x40, 0x6a, 0x58, 0x16, 0xb6, 0x39, 0x41, 0x00, 0xf3, 0x7a, 0x1c, 0x69, 0x79, 0x75, 0x54,
        0x78, 0x0b, 0xb3, 0x8c, 0xc5, 0xa9, 0x9f, 0x5e, 0xde, 0x4c, 0xf7, 0x3c, 0x3e, 0xc2, 0x49,
        0x3a, 0x18, 0x39, 0xb3, 0xdb, 0xcb, 0xa3, 0xf6, 0xea, 0x46, 0xc5, 0xb7, 0x68, 0x4d, 0xf3,
        0x54, 0x8e, 0x7d, 0xde, 0xb9, 0xc3, 0xbf, 0x9c, 0x73, 0xcc, 0x3f, 0x3b, 0xde, 0xd7, 0x4b,
        0x56, 0x2b, 0xfb, 0x19, 0xfb, 0x84, 0x02, 0x2f, 0x8e, 0xf4, 0xcd, 0xd9, 0x37, 0x95, 0xd7,
        0x7d, 0x06, 0xed, 0xbb, 0x7a, 0xaf, 0x2f, 0x58, 0x89, 0x18, 0x50, 0xab, 0xbd, 0xca, 0x3d,
        0x20, 0x39, 0x8c, 0x27, 0x64, 0x56, 0xcb, 0xc4, 0x21, 0x58, 0x40, 0x7d, 0xd0, 0x74, 0xee,
    ];

    #[test]
    fn sample_server_initial() {
        fixture_init();
        let mut prot = CryptoDxState::test_default();

        // The spec uses PN=1, but our crypto refuses to skip packet numbers.
        // So burn an encryption:
        let burn = prot.encrypt(0, &[], &[]).expect("burn OK");
        assert_eq!(burn.len(), prot.expansion());

        let mut builder = PacketBuilder::long(
            Encoder::new(),
            PacketType::Initial,
            Version::default(),
            None::<&[u8]>,
            Some(ConnectionId::from(SERVER_CID)),
        );
        builder.initial_token(&[]);
        builder.pn(1, 2);
        builder.encode(SAMPLE_INITIAL_PAYLOAD);
        let packet = builder.build(&mut prot).expect("build");
        assert_eq!(packet.as_ref(), SAMPLE_INITIAL);
    }

    #[test]
    fn decrypt_initial() {
        const EXTRA: &[u8] = &[0xce; 33];

        fixture_init();
        let mut padded = SAMPLE_INITIAL.to_vec();
        padded.extend_from_slice(EXTRA);
        let (packet, remainder) = PublicPacket::decode(&padded, &cid_mgr()).unwrap();
        assert_eq!(packet.packet_type(), PacketType::Initial);
        assert_eq!(&packet.dcid()[..], &[] as &[u8]);
        assert_eq!(&packet.scid()[..], SERVER_CID);
        assert!(packet.token().is_empty());
        assert_eq!(remainder, EXTRA);

        let decrypted = packet
            .decrypt(&mut CryptoStates::test_default(), now())
            .unwrap();
        assert_eq!(decrypted.pn(), 1);
    }

    #[test]
    fn disallow_long_dcid() {
        let mut enc = Encoder::new();
        enc.encode_byte(PACKET_BIT_LONG | PACKET_BIT_FIXED_QUIC);
        enc.encode_uint(4, Version::default().wire_version());
        enc.encode_vec(1, &[0x00; MAX_CONNECTION_ID_LEN + 1]);
        enc.encode_vec(1, &[]);
        enc.encode(&[0xff; 40]); // junk

        assert!(PublicPacket::decode(enc.as_ref(), &cid_mgr()).is_err());
    }

    #[test]
    fn disallow_long_scid() {
        let mut enc = Encoder::new();
        enc.encode_byte(PACKET_BIT_LONG | PACKET_BIT_FIXED_QUIC);
        enc.encode_uint(4, Version::default().wire_version());
        enc.encode_vec(1, &[]);
        enc.encode_vec(1, &[0x00; MAX_CONNECTION_ID_LEN + 2]);
        enc.encode(&[0xff; 40]); // junk

        assert!(PublicPacket::decode(enc.as_ref(), &cid_mgr()).is_err());
    }

    const SAMPLE_SHORT: &[u8] = &[
        0x40, 0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5, 0xf4, 0xa8, 0x30, 0x39, 0xc4, 0x7d,
        0x99, 0xe3, 0x94, 0x1c, 0x9b, 0xb9, 0x7a, 0x30, 0x1d, 0xd5, 0x8f, 0xf3, 0xdd, 0xa9,
    ];
    const SAMPLE_SHORT_PAYLOAD: &[u8] = &[0; 3];

    #[test]
    fn build_short() {
        fixture_init();
        let mut builder =
            PacketBuilder::short(Encoder::new(), true, Some(ConnectionId::from(SERVER_CID)));
        builder.pn(0, 1);
        builder.encode(SAMPLE_SHORT_PAYLOAD); // Enough payload for sampling.
        let packet = builder
            .build(&mut CryptoDxState::test_default())
            .expect("build");
        assert_eq!(packet.as_ref(), SAMPLE_SHORT);
    }

    #[test]
    fn scramble_short() {
        fixture_init();
        let mut firsts = Vec::new();
        for _ in 0..64 {
            let mut builder =
                PacketBuilder::short(Encoder::new(), true, Some(ConnectionId::from(SERVER_CID)));
            builder.scramble(true);
            builder.pn(0, 1);
            firsts.push(builder.as_ref()[0]);
        }
        let is_set = |bit| move |v| v & bit == bit;
        // There should be at least one value with the QUIC bit set:
        assert!(firsts.iter().any(is_set(PACKET_BIT_FIXED_QUIC)));
        // ... but not all:
        assert!(!firsts.iter().all(is_set(PACKET_BIT_FIXED_QUIC)));
        // There should be at least one value with the spin bit set:
        assert!(firsts.iter().any(is_set(PACKET_BIT_SPIN)));
        // ... but not all:
        assert!(!firsts.iter().all(is_set(PACKET_BIT_SPIN)));
    }

    #[test]
    fn decode_short() {
        fixture_init();
        let (packet, remainder) = PublicPacket::decode(SAMPLE_SHORT, &cid_mgr()).unwrap();
        assert_eq!(packet.packet_type(), PacketType::Short);
        assert!(remainder.is_empty());
        let decrypted = packet
            .decrypt(&mut CryptoStates::test_default(), now())
            .unwrap();
        assert_eq!(&decrypted[..], SAMPLE_SHORT_PAYLOAD);
    }

    /// By telling the decoder that the connection ID is shorter than it really is, we get a
    /// decryption error.
    #[test]
    fn decode_short_bad_cid() {
        fixture_init();
        let (packet, remainder) = PublicPacket::decode(
            SAMPLE_SHORT,
            &RandomConnectionIdGenerator::new(SERVER_CID.len() - 1),
        )
        .unwrap();
        assert_eq!(packet.packet_type(), PacketType::Short);
        assert!(remainder.is_empty());
        assert!(packet
            .decrypt(&mut CryptoStates::test_default(), now())
            .is_err());
    }

    /// Saying that the connection ID is longer causes the initial decode to fail.
    #[test]
    fn decode_short_long_cid() {
        assert!(PublicPacket::decode(
            SAMPLE_SHORT,
            &RandomConnectionIdGenerator::new(SERVER_CID.len() + 1)
        )
        .is_err());
    }

    #[test]
    fn build_two() {
        fixture_init();
        let mut prot = CryptoDxState::test_default();
        let mut builder = PacketBuilder::long(
            Encoder::new(),
            PacketType::Handshake,
            Version::default(),
            Some(ConnectionId::from(SERVER_CID)),
            Some(ConnectionId::from(CLIENT_CID)),
        );
        builder.pn(0, 1);
        builder.encode(&[0; 3]);
        let encoder = builder.build(&mut prot).expect("build");
        assert_eq!(encoder.len(), 45);
        let first = encoder.clone();

        let mut builder =
            PacketBuilder::short(encoder, false, Some(ConnectionId::from(SERVER_CID)));
        builder.pn(1, 3);
        builder.encode(&[0]); // Minimal size (packet number is big enough).
        let encoder = builder.build(&mut prot).expect("build");
        assert_eq!(
            first.as_ref(),
            &encoder.as_ref()[..first.len()],
            "the first packet should be a prefix"
        );
        assert_eq!(encoder.len(), 45 + 29);
    }

    #[test]
    fn build_long() {
        const EXPECTED: &[u8] = &[
            0xe4, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x40, 0x14, 0xfb, 0xa9, 0x32, 0x3a, 0xf8,
            0xbb, 0x18, 0x63, 0xc6, 0xbd, 0x78, 0x0e, 0xba, 0x0c, 0x98, 0x65, 0x58, 0xc9, 0x62,
            0x31,
        ];

        fixture_init();
        let mut builder = PacketBuilder::long(
            Encoder::new(),
            PacketType::Handshake,
            Version::default(),
            None::<&[u8]>,
            None::<&[u8]>,
        );
        builder.pn(0, 1);
        builder.encode(&[1, 2, 3]);
        let packet = builder.build(&mut CryptoDxState::test_default()).unwrap();
        assert_eq!(packet.as_ref(), EXPECTED);
    }

    #[test]
    fn scramble_long() {
        fixture_init();
        let mut found_unset = false;
        let mut found_set = false;
        for _ in 1..64 {
            let mut builder = PacketBuilder::long(
                Encoder::new(),
                PacketType::Handshake,
                Version::default(),
                None::<&[u8]>,
                None::<&[u8]>,
            );
            builder.pn(0, 1);
            builder.scramble(true);
            if (builder.as_ref()[0] & PACKET_BIT_FIXED_QUIC) == 0 {
                found_unset = true;
            } else {
                found_set = true;
            }
        }
        assert!(found_unset);
        assert!(found_set);
    }

    #[test]
    fn build_abort() {
        let mut builder = PacketBuilder::long(
            Encoder::new(),
            PacketType::Initial,
            Version::default(),
            None::<&[u8]>,
            Some(ConnectionId::from(SERVER_CID)),
        );
        assert_ne!(builder.remaining(), 0);
        builder.initial_token(&[]);
        assert_ne!(builder.remaining(), 0);
        builder.pn(1, 2);
        assert_ne!(builder.remaining(), 0);
        let encoder = builder.abort();
        assert!(encoder.is_empty());
    }

    #[test]
    fn build_insufficient_space() {
        fixture_init();

        let mut builder = PacketBuilder::short(
            Encoder::with_capacity(100),
            true,
            Some(ConnectionId::from(SERVER_CID)),
        );
        builder.pn(0, 1);
        // Pad, but not up to the full capacity. Leave enough space for the
        // AEAD expansion and some extra, but not for an entire long header.
        builder.set_limit(75);
        builder.enable_padding(true);
        assert!(builder.pad());
        let encoder = builder.build(&mut CryptoDxState::test_default()).unwrap();
        let encoder_copy = encoder.clone();

        let builder = PacketBuilder::long(
            encoder,
            PacketType::Initial,
            Version::default(),
            Some(ConnectionId::from(SERVER_CID)),
            Some(ConnectionId::from(SERVER_CID)),
        );
        assert_eq!(builder.remaining(), 0);
        assert_eq!(builder.abort(), encoder_copy);
    }

    const SAMPLE_RETRY_V2: &[u8] = &[
        0xcf, 0x6b, 0x33, 0x43, 0xcf, 0x00, 0x08, 0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5,
        0x74, 0x6f, 0x6b, 0x65, 0x6e, 0xc8, 0x64, 0x6c, 0xe8, 0xbf, 0xe3, 0x39, 0x52, 0xd9, 0x55,
        0x54, 0x36, 0x65, 0xdc, 0xc7, 0xb6,
    ];

    const SAMPLE_RETRY_V1: &[u8] = &[
        0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5,
        0x74, 0x6f, 0x6b, 0x65, 0x6e, 0x04, 0xa2, 0x65, 0xba, 0x2e, 0xff, 0x4d, 0x82, 0x90, 0x58,
        0xfb, 0x3f, 0x0f, 0x24, 0x96, 0xba,
    ];

    const SAMPLE_RETRY_29: &[u8] = &[
        0xff, 0xff, 0x00, 0x00, 0x1d, 0x00, 0x08, 0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5,
        0x74, 0x6f, 0x6b, 0x65, 0x6e, 0xd1, 0x69, 0x26, 0xd8, 0x1f, 0x6f, 0x9c, 0xa2, 0x95, 0x3a,
        0x8a, 0xa4, 0x57, 0x5e, 0x1e, 0x49,
    ];

    const RETRY_TOKEN: &[u8] = b"token";

    fn build_retry_single(version: Version, sample_retry: &[u8]) {
        fixture_init();
        let retry =
            PacketBuilder::retry(version, &[], SERVER_CID, RETRY_TOKEN, CLIENT_CID).unwrap();

        let (packet, remainder) = PublicPacket::decode(&retry, &cid_mgr()).unwrap();
        assert!(packet.is_valid_retry(&ConnectionId::from(CLIENT_CID)));
        assert!(remainder.is_empty());

        // The builder adds randomness, which makes expectations hard.
        // So only do a full check when that randomness matches up.
        if retry[0] == sample_retry[0] {
            assert_eq!(&retry, &sample_retry);
        } else {
            // Otherwise, just check that the header is OK.
            assert_eq!(
                retry[0] & 0xf0,
                0xc0 | (PacketType::Retry.to_byte(version) << 4)
            );
            let header_range = 1..retry.len() - 16;
            assert_eq!(&retry[header_range.clone()], &sample_retry[header_range]);
        }
    }

    #[test]
    fn build_retry_v2() {
        build_retry_single(Version::Version2, SAMPLE_RETRY_V2);
    }

    #[test]
    fn build_retry_v1() {
        build_retry_single(Version::Version1, SAMPLE_RETRY_V1);
    }

    #[test]
    fn build_retry_29() {
        build_retry_single(Version::Draft29, SAMPLE_RETRY_29);
    }

    #[test]
    fn build_retry_multiple() {
        // Run the build_retry test a few times.
        // Odds are approximately 1 in 8 that the full comparison doesn't happen
        // for a given version.
        for _ in 0..32 {
            build_retry_v2();
            build_retry_v1();
            build_retry_29();
        }
    }

    fn decode_retry(version: Version, sample_retry: &[u8]) {
        fixture_init();
        let (packet, remainder) =
            PublicPacket::decode(sample_retry, &RandomConnectionIdGenerator::new(5)).unwrap();
        assert!(packet.is_valid_retry(&ConnectionId::from(CLIENT_CID)));
        assert_eq!(Some(version), packet.version());
        assert!(packet.dcid().is_empty());
        assert_eq!(&packet.scid()[..], SERVER_CID);
        assert_eq!(packet.token(), RETRY_TOKEN);
        assert!(remainder.is_empty());
    }

    #[test]
    fn decode_retry_v2() {
        decode_retry(Version::Version2, SAMPLE_RETRY_V2);
    }

    #[test]
    fn decode_retry_v1() {
        decode_retry(Version::Version1, SAMPLE_RETRY_V1);
    }

    #[test]
    fn decode_retry_29() {
        decode_retry(Version::Draft29, SAMPLE_RETRY_29);
    }

    /// Check some packets that are clearly not valid Retry packets.
    #[test]
    fn invalid_retry() {
        fixture_init();
        let cid_mgr = RandomConnectionIdGenerator::new(5);
        let odcid = ConnectionId::from(CLIENT_CID);

        assert!(PublicPacket::decode(&[], &cid_mgr).is_err());

        let (packet, remainder) = PublicPacket::decode(SAMPLE_RETRY_V1, &cid_mgr).unwrap();
        assert!(remainder.is_empty());
        assert!(packet.is_valid_retry(&odcid));

        let mut damaged_retry = SAMPLE_RETRY_V1.to_vec();
        let last = damaged_retry.len() - 1;
        damaged_retry[last] ^= 66;
        let (packet, remainder) = PublicPacket::decode(&damaged_retry, &cid_mgr).unwrap();
        assert!(remainder.is_empty());
        assert!(!packet.is_valid_retry(&odcid));

        damaged_retry.truncate(last);
        let (packet, remainder) = PublicPacket::decode(&damaged_retry, &cid_mgr).unwrap();
        assert!(remainder.is_empty());
        assert!(!packet.is_valid_retry(&odcid));

        // An invalid token should be rejected sooner.
        damaged_retry.truncate(last - 4);
        assert!(PublicPacket::decode(&damaged_retry, &cid_mgr).is_err());

        damaged_retry.truncate(last - 1);
        assert!(PublicPacket::decode(&damaged_retry, &cid_mgr).is_err());
    }

    const SAMPLE_VN: &[u8] = &[
        0x80, 0x00, 0x00, 0x00, 0x00, 0x08, 0xf0, 0x67, 0xa5, 0x50, 0x2a, 0x42, 0x62, 0xb5, 0x08,
        0x83, 0x94, 0xc8, 0xf0, 0x3e, 0x51, 0x57, 0x08, 0x6b, 0x33, 0x43, 0xcf, 0x00, 0x00, 0x00,
        0x01, 0xff, 0x00, 0x00, 0x1d, 0x0a, 0x0a, 0x0a, 0x0a,
    ];

    #[test]
    fn build_vn() {
        fixture_init();
        let mut vn = PacketBuilder::version_negotiation(
            SERVER_CID,
            CLIENT_CID,
            0x0a0a_0a0a,
            &Version::all(),
        );
        // Erase randomness from greasing...
        assert_eq!(vn.len(), SAMPLE_VN.len());
        vn[0] &= 0x80;
        for v in vn.iter_mut().skip(SAMPLE_VN.len() - 4) {
            *v &= 0x0f;
        }
        assert_eq!(&vn, &SAMPLE_VN);
    }

    #[test]
    fn vn_do_not_repeat_client_grease() {
        fixture_init();
        let vn = PacketBuilder::version_negotiation(
            SERVER_CID,
            CLIENT_CID,
            0x0a0a_0a0a,
            &Version::all(),
        );
        assert_ne!(&vn[SAMPLE_VN.len() - 4..], &[0x0a, 0x0a, 0x0a, 0x0a]);
    }

    #[test]
    fn parse_vn() {
        let (packet, remainder) =
            PublicPacket::decode(SAMPLE_VN, &EmptyConnectionIdGenerator::default()).unwrap();
        assert!(remainder.is_empty());
        assert_eq!(&packet.dcid[..], SERVER_CID);
        assert!(packet.scid.is_some());
        assert_eq!(&packet.scid.unwrap()[..], CLIENT_CID);
    }

    /// A Version Negotiation packet can have a long connection ID.
    #[test]
    fn parse_vn_big_cid() {
        const BIG_DCID: &[u8] = &[0x44; MAX_CONNECTION_ID_LEN + 1];
        const BIG_SCID: &[u8] = &[0xee; 255];

        let mut enc = Encoder::from(&[0xff, 0x00, 0x00, 0x00, 0x00][..]);
        enc.encode_vec(1, BIG_DCID);
        enc.encode_vec(1, BIG_SCID);
        enc.encode_uint(4, 0x1a2a_3a4a_u64);
        enc.encode_uint(4, Version::default().wire_version());
        enc.encode_uint(4, 0x5a6a_7a8a_u64);

        let (packet, remainder) =
            PublicPacket::decode(enc.as_ref(), &EmptyConnectionIdGenerator::default()).unwrap();
        assert!(remainder.is_empty());
        assert_eq!(&packet.dcid[..], BIG_DCID);
        assert!(packet.scid.is_some());
        assert_eq!(&packet.scid.unwrap()[..], BIG_SCID);
    }

    #[test]
    fn decode_pn() {
        // When the expected value is low, the value doesn't go negative.
        assert_eq!(PublicPacket::decode_pn(0, 0, 1), 0);
        assert_eq!(PublicPacket::decode_pn(0, 0xff, 1), 0xff);
        assert_eq!(PublicPacket::decode_pn(10, 0, 1), 0);
        assert_eq!(PublicPacket::decode_pn(0x7f, 0, 1), 0);
        assert_eq!(PublicPacket::decode_pn(0x80, 0, 1), 0x100);
        assert_eq!(PublicPacket::decode_pn(0x80, 2, 1), 2);
        assert_eq!(PublicPacket::decode_pn(0x80, 0xff, 1), 0xff);
        assert_eq!(PublicPacket::decode_pn(0x7ff, 0xfe, 1), 0x7fe);

        // This is invalid by spec, as we are expected to check for overflow around 2^62-1,
        // but we don't need to worry about overflow
        // and hitting this is basically impossible in practice.
        assert_eq!(
            PublicPacket::decode_pn(0x3fff_ffff_ffff_ffff, 2, 4),
            0x4000_0000_0000_0002
        );
    }

    #[test]
    fn chacha20_sample() {
        const PACKET: &[u8] = &[
            0x4c, 0xfe, 0x41, 0x89, 0x65, 0x5e, 0x5c, 0xd5, 0x5c, 0x41, 0xf6, 0x90, 0x80, 0x57,
            0x5d, 0x79, 0x99, 0xc2, 0x5a, 0x5b, 0xfb,
        ];
        fixture_init();
        let (packet, slice) =
            PublicPacket::decode(PACKET, &EmptyConnectionIdGenerator::default()).unwrap();
        assert!(slice.is_empty());
        let decrypted = packet
            .decrypt(&mut CryptoStates::test_chacha(), now())
            .unwrap();
        assert_eq!(decrypted.packet_type(), PacketType::Short);
        assert_eq!(decrypted.pn(), 654_360_564);
        assert_eq!(&decrypted[..], &[0x01]);
    }

    #[test]
    fn decode_empty() {
        neqo_crypto::init().unwrap();
        let res = PublicPacket::decode(&[], &EmptyConnectionIdGenerator::default());
        assert!(res.is_err());
    }

    #[test]
    fn decode_too_short() {
        neqo_crypto::init().unwrap();
        let res = PublicPacket::decode(
            &[179, 255, 0, 0, 29, 0, 0],
            &EmptyConnectionIdGenerator::default(),
        );
        assert!(res.is_err());
    }
}
