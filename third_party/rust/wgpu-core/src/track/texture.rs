/*! Texture Trackers
 *
 * Texture trackers are significantly more complicated than
 * the buffer trackers because textures can be in a "complex"
 * state where each individual subresource can potentially be
 * in a different state from every other subtresource. These
 * complex states are stored separately from the simple states
 * because they are signifignatly more difficult to track and
 * most resources spend the vast majority of their lives in
 * simple states.
 *
 * There are two special texture usages: `UNKNOWN` and `UNINITIALIZED`.
 * - `UNKNOWN` is only used in complex states and is used to signify
 *   that the complex state does not know anything about those subresources.
 *   It cannot leak into transitions, it is invalid to transition into UNKNOWN
 *   state.
 * - `UNINITIALIZED` is used in both simple and complex states to mean the texture
 *   is known to be in some undefined state. Any transition away from UNINITIALIZED
 *   will treat the contents as junk.
!*/

use super::{
    range::RangedStates, PendingTransition, PendingTransitionList, ResourceTracker, TrackerIndex,
};
use crate::{
    hal_api::HalApi,
    lock::{rank, Mutex},
    resource::{Resource, Texture, TextureInner},
    snatch::SnatchGuard,
    track::{
        invalid_resource_state, skip_barrier, ResourceMetadata, ResourceMetadataProvider,
        ResourceUses, UsageConflict,
    },
};
use hal::TextureUses;

use arrayvec::ArrayVec;
use naga::FastHashMap;

use wgt::{strict_assert, strict_assert_eq};

use std::{borrow::Cow, iter, marker::PhantomData, ops::Range, sync::Arc, vec::Drain};

/// Specifies a particular set of subresources in a texture.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextureSelector {
    pub mips: Range<u32>,
    pub layers: Range<u32>,
}

impl ResourceUses for TextureUses {
    const EXCLUSIVE: Self = Self::EXCLUSIVE;

    type Selector = TextureSelector;

    fn bits(self) -> u16 {
        Self::bits(&self)
    }

    fn all_ordered(self) -> bool {
        Self::ORDERED.contains(self)
    }

    fn any_exclusive(self) -> bool {
        self.intersects(Self::EXCLUSIVE)
    }
}

/// Represents the complex state of textures where every subresource is potentially
/// in a different state.
#[derive(Clone, Debug, Default, PartialEq)]
struct ComplexTextureState {
    mips: ArrayVec<RangedStates<u32, TextureUses>, { hal::MAX_MIP_LEVELS as usize }>,
}

impl ComplexTextureState {
    /// Creates complex texture state for the given sizes.
    ///
    /// This state will be initialized with the UNKNOWN state, a special state
    /// which means the trakcer knows nothing about the state.
    fn new(mip_level_count: u32, array_layer_count: u32) -> Self {
        Self {
            mips: iter::repeat_with(|| {
                RangedStates::from_range(0..array_layer_count, TextureUses::UNKNOWN)
            })
            .take(mip_level_count as usize)
            .collect(),
        }
    }

    /// Initialize a complex state from a selector representing the full size of the texture
    /// and an iterator of a selector and a texture use, specifying a usage for a specific
    /// set of subresources.
    ///
    /// [`Self::to_selector_state_iter`] can be used to create such an iterator.
    ///
    /// # Safety
    ///
    /// All selectors in the iterator must be inside of the full_range selector.
    ///
    /// The full range selector must have mips and layers start at 0.
    unsafe fn from_selector_state_iter(
        full_range: TextureSelector,
        state_iter: impl Iterator<Item = (TextureSelector, TextureUses)>,
    ) -> Self {
        strict_assert_eq!(full_range.layers.start, 0);
        strict_assert_eq!(full_range.mips.start, 0);

        let mut complex =
            ComplexTextureState::new(full_range.mips.len() as u32, full_range.layers.len() as u32);
        for (selector, desired_state) in state_iter {
            strict_assert!(selector.layers.end <= full_range.layers.end);
            strict_assert!(selector.mips.end <= full_range.mips.end);

            // This should only ever happen with a wgpu bug, but let's just double
            // check that resource states don't have any conflicts.
            strict_assert_eq!(invalid_resource_state(desired_state), false);

            let mips = selector.mips.start as usize..selector.mips.end as usize;
            for mip in unsafe { complex.mips.get_unchecked_mut(mips) } {
                for &mut (_, ref mut state) in mip.isolate(&selector.layers, TextureUses::UNKNOWN) {
                    *state = desired_state;
                }
            }
        }
        complex
    }

    /// Convert a complex state into an iterator over all states stored.
    ///
    /// [`Self::from_selector_state_iter`] can be used to consume such an iterator.
    fn to_selector_state_iter(
        &self,
    ) -> impl Iterator<Item = (TextureSelector, TextureUses)> + Clone + '_ {
        self.mips.iter().enumerate().flat_map(|(mip, inner)| {
            let mip = mip as u32;
            {
                inner.iter().map(move |&(ref layers, inner)| {
                    (
                        TextureSelector {
                            mips: mip..mip + 1,
                            layers: layers.clone(),
                        },
                        inner,
                    )
                })
            }
        })
    }
}

#[derive(Debug)]
struct TextureBindGroupStateData<A: HalApi> {
    selector: Option<TextureSelector>,
    texture: Arc<Texture<A>>,
    usage: TextureUses,
}

/// Stores all the textures that a bind group stores.
#[derive(Debug)]
pub(crate) struct TextureBindGroupState<A: HalApi> {
    textures: Mutex<Vec<TextureBindGroupStateData<A>>>,
}
impl<A: HalApi> TextureBindGroupState<A> {
    pub fn new() -> Self {
        Self {
            textures: Mutex::new(rank::TEXTURE_BIND_GROUP_STATE_TEXTURES, Vec::new()),
        }
    }

    /// Optimize the texture bind group state by sorting it by ID.
    ///
    /// When this list of states is merged into a tracker, the memory
    /// accesses will be in a constant ascending order.
    pub(crate) fn optimize(&self) {
        let mut textures = self.textures.lock();
        textures.sort_unstable_by_key(|v| v.texture.as_info().tracker_index());
    }

    /// Returns a list of all textures tracked. May contain duplicates.
    pub fn drain_resources(&self) -> impl Iterator<Item = Arc<Texture<A>>> + '_ {
        let mut textures = self.textures.lock();
        textures
            .drain(..)
            .map(|v| v.texture)
            .collect::<Vec<_>>()
            .into_iter()
    }

    /// Adds the given resource with the given state.
    pub fn add_single<'a>(
        &self,
        texture: &'a Arc<Texture<A>>,
        selector: Option<TextureSelector>,
        state: TextureUses,
    ) -> Option<&'a Arc<Texture<A>>> {
        let mut textures = self.textures.lock();
        textures.push(TextureBindGroupStateData {
            selector,
            texture: texture.clone(),
            usage: state,
        });
        Some(texture)
    }
}

/// Container for corresponding simple and complex texture states.
#[derive(Debug)]
pub(crate) struct TextureStateSet {
    simple: Vec<TextureUses>,
    complex: FastHashMap<usize, ComplexTextureState>,
}

impl TextureStateSet {
    fn new() -> Self {
        Self {
            simple: Vec::new(),
            complex: FastHashMap::default(),
        }
    }

    fn clear(&mut self) {
        self.simple.clear();
        self.complex.clear();
    }

    fn set_size(&mut self, size: usize) {
        self.simple.resize(size, TextureUses::UNINITIALIZED);
    }
}

/// Stores all texture state within a single usage scope.
#[derive(Debug)]
pub(crate) struct TextureUsageScope<A: HalApi> {
    set: TextureStateSet,
    metadata: ResourceMetadata<Texture<A>>,
}

impl<A: HalApi> Default for TextureUsageScope<A> {
    fn default() -> Self {
        Self {
            set: TextureStateSet::new(),
            metadata: ResourceMetadata::new(),
        }
    }
}

impl<A: HalApi> TextureUsageScope<A> {
    fn tracker_assert_in_bounds(&self, index: usize) {
        self.metadata.tracker_assert_in_bounds(index);

        strict_assert!(index < self.set.simple.len());

        strict_assert!(if self.metadata.contains(index)
            && self.set.simple[index] == TextureUses::COMPLEX
        {
            self.set.complex.contains_key(&index)
        } else {
            true
        });
    }

    pub fn clear(&mut self) {
        self.set.clear();
        self.metadata.clear();
    }

    /// Sets the size of all the vectors inside the tracker.
    ///
    /// Must be called with the highest possible Texture ID before
    /// all unsafe functions are called.
    pub fn set_size(&mut self, size: usize) {
        self.set.set_size(size);
        self.metadata.set_size(size);
    }

    /// Drains all textures tracked.
    pub(crate) fn drain_resources(&mut self) -> impl Iterator<Item = Arc<Texture<A>>> + '_ {
        let resources = self.metadata.drain_resources();
        self.set.clear();
        resources.into_iter()
    }

    /// Returns true if the tracker owns no resources.
    ///
    /// This is a O(n) operation.
    pub(crate) fn is_empty(&self) -> bool {
        self.metadata.is_empty()
    }

    /// Merge the list of texture states in the given usage scope into this UsageScope.
    ///
    /// If any of the resulting states is invalid, stops the merge and returns a usage
    /// conflict with the details of the invalid state.
    ///
    /// If the given tracker uses IDs higher than the length of internal vectors,
    /// the vectors will be extended. A call to set_size is not needed.
    pub fn merge_usage_scope(&mut self, scope: &Self) -> Result<(), UsageConflict> {
        let incoming_size = scope.set.simple.len();
        if incoming_size > self.set.simple.len() {
            self.set_size(incoming_size);
        }

        for index in scope.metadata.owned_indices() {
            self.tracker_assert_in_bounds(index);
            scope.tracker_assert_in_bounds(index);

            let texture_selector =
                unsafe { &scope.metadata.get_resource_unchecked(index).full_range };
            unsafe {
                insert_or_merge(
                    texture_selector,
                    &mut self.set,
                    &mut self.metadata,
                    index,
                    TextureStateProvider::TextureSet { set: &scope.set },
                    ResourceMetadataProvider::Indirect {
                        metadata: &scope.metadata,
                    },
                )?
            };
        }

        Ok(())
    }

    /// Merge the list of texture states in the given bind group into this usage scope.
    ///
    /// If any of the resulting states is invalid, stops the merge and returns a usage
    /// conflict with the details of the invalid state.
    ///
    /// Because bind groups do not check if the union of all their states is valid,
    /// this method is allowed to return Err on the first bind group bound.
    ///
    /// # Safety
    ///
    /// [`Self::set_size`] must be called with the maximum possible Buffer ID before this
    /// method is called.
    pub unsafe fn merge_bind_group(
        &mut self,
        bind_group: &TextureBindGroupState<A>,
    ) -> Result<(), UsageConflict> {
        let textures = bind_group.textures.lock();
        for t in &*textures {
            unsafe { self.merge_single(&t.texture, t.selector.clone(), t.usage)? };
        }

        Ok(())
    }

    /// Merge a single state into the UsageScope.
    ///
    /// If the resulting state is invalid, returns a usage
    /// conflict with the details of the invalid state.
    ///
    /// # Safety
    ///
    /// Unlike other trackers whose merge_single is safe, this method is only
    /// called where there is already other unsafe tracking functions active,
    /// so we can prove this unsafe "for free".
    ///
    /// [`Self::set_size`] must be called with the maximum possible Buffer ID before this
    /// method is called.
    pub unsafe fn merge_single(
        &mut self,
        texture: &Arc<Texture<A>>,
        selector: Option<TextureSelector>,
        new_state: TextureUses,
    ) -> Result<(), UsageConflict> {
        let index = texture.as_info().tracker_index().as_usize();

        self.tracker_assert_in_bounds(index);

        let texture_selector = &texture.full_range;
        unsafe {
            insert_or_merge(
                texture_selector,
                &mut self.set,
                &mut self.metadata,
                index,
                TextureStateProvider::from_option(selector, new_state),
                ResourceMetadataProvider::Direct {
                    resource: Cow::Borrowed(texture),
                },
            )?
        };

        Ok(())
    }
}

/// Stores all texture state within a command buffer or device.
pub(crate) struct TextureTracker<A: HalApi> {
    start_set: TextureStateSet,
    end_set: TextureStateSet,

    metadata: ResourceMetadata<Texture<A>>,

    temp: Vec<PendingTransition<TextureUses>>,

    _phantom: PhantomData<A>,
}

impl<A: HalApi> ResourceTracker for TextureTracker<A> {
    /// Try to remove the given resource from the tracker iff we have the last reference to the
    /// resource and the epoch matches.
    ///
    /// Returns true if the resource was removed or if not existing in metadata.
    ///
    /// If the ID is higher than the length of internal vectors,
    /// false will be returned.
    fn remove_abandoned(&mut self, index: TrackerIndex) -> bool {
        let index = index.as_usize();

        if index >= self.metadata.size() {
            return false;
        }

        self.tracker_assert_in_bounds(index);

        unsafe {
            if self.metadata.contains_unchecked(index) {
                let existing_ref_count = self.metadata.get_ref_count_unchecked(index);
                //RefCount 2 means that resource is hold just by DeviceTracker and this suspected resource itself
                //so it's already been released from user and so it's not inside Registry\Storage
                if existing_ref_count <= 2 {
                    self.start_set.complex.remove(&index);
                    self.end_set.complex.remove(&index);
                    self.metadata.remove(index);
                    return true;
                }

                return false;
            }
        }
        true
    }
}

impl<A: HalApi> TextureTracker<A> {
    pub fn new() -> Self {
        Self {
            start_set: TextureStateSet::new(),
            end_set: TextureStateSet::new(),

            metadata: ResourceMetadata::new(),

            temp: Vec::new(),

            _phantom: PhantomData,
        }
    }

    fn tracker_assert_in_bounds(&self, index: usize) {
        self.metadata.tracker_assert_in_bounds(index);

        strict_assert!(index < self.start_set.simple.len());
        strict_assert!(index < self.end_set.simple.len());

        strict_assert!(if self.metadata.contains(index)
            && self.start_set.simple[index] == TextureUses::COMPLEX
        {
            self.start_set.complex.contains_key(&index)
        } else {
            true
        });
        strict_assert!(if self.metadata.contains(index)
            && self.end_set.simple[index] == TextureUses::COMPLEX
        {
            self.end_set.complex.contains_key(&index)
        } else {
            true
        });
    }

    /// Sets the size of all the vectors inside the tracker.
    ///
    /// Must be called with the highest possible Texture ID before
    /// all unsafe functions are called.
    pub fn set_size(&mut self, size: usize) {
        self.start_set.set_size(size);
        self.end_set.set_size(size);

        self.metadata.set_size(size);
    }

    /// Extend the vectors to let the given index be valid.
    fn allow_index(&mut self, index: usize) {
        if index >= self.start_set.simple.len() {
            self.set_size(index + 1);
        }
    }

    /// Returns a list of all textures tracked.
    pub fn used_resources(&self) -> impl Iterator<Item = Arc<Texture<A>>> + '_ {
        self.metadata.owned_resources()
    }

    /// Drain all currently pending transitions.
    pub fn drain_transitions<'a>(
        &'a mut self,
        snatch_guard: &'a SnatchGuard<'a>,
    ) -> (PendingTransitionList, Vec<Option<&'a TextureInner<A>>>) {
        let mut textures = Vec::new();
        let transitions = self
            .temp
            .drain(..)
            .map(|pending| {
                let tex = unsafe { self.metadata.get_resource_unchecked(pending.id as _) };
                textures.push(tex.inner.get(snatch_guard));
                pending
            })
            .collect();
        (transitions, textures)
    }

    /// Inserts a single texture and a state into the resource tracker.
    ///
    /// If the resource already exists in the tracker, this will panic.
    ///
    /// If the ID is higher than the length of internal vectors,
    /// the vectors will be extended. A call to set_size is not needed.
    pub fn insert_single(&mut self, resource: Arc<Texture<A>>, usage: TextureUses) {
        let index = resource.info.tracker_index().as_usize();

        self.allow_index(index);

        self.tracker_assert_in_bounds(index);

        unsafe {
            let currently_owned = self.metadata.contains_unchecked(index);

            if currently_owned {
                panic!("Tried to insert texture already tracked");
            }

            insert(
                None,
                Some(&mut self.start_set),
                &mut self.end_set,
                &mut self.metadata,
                index,
                TextureStateProvider::KnownSingle { state: usage },
                None,
                ResourceMetadataProvider::Direct {
                    resource: Cow::Owned(resource),
                },
            )
        };
    }

    /// Sets the state of a single texture.
    ///
    /// If a transition is needed to get the texture into the given state, that transition
    /// is returned.
    ///
    /// If the ID is higher than the length of internal vectors,
    /// the vectors will be extended. A call to set_size is not needed.
    pub fn set_single(
        &mut self,
        texture: &Arc<Texture<A>>,
        selector: TextureSelector,
        new_state: TextureUses,
    ) -> Option<Drain<'_, PendingTransition<TextureUses>>> {
        let index = texture.as_info().tracker_index().as_usize();

        self.allow_index(index);

        self.tracker_assert_in_bounds(index);

        unsafe {
            insert_or_barrier_update(
                &texture.full_range,
                Some(&mut self.start_set),
                &mut self.end_set,
                &mut self.metadata,
                index,
                TextureStateProvider::Selector {
                    selector,
                    state: new_state,
                },
                None,
                ResourceMetadataProvider::Direct {
                    resource: Cow::Owned(texture.clone()),
                },
                &mut self.temp,
            )
        }

        Some(self.temp.drain(..))
    }

    /// Sets the given state for all texture in the given tracker.
    ///
    /// If a transition is needed to get the texture into the needed state,
    /// those transitions are stored within the tracker. A subsequent
    /// call to [`Self::drain_transitions`] is needed to get those transitions.
    ///
    /// If the ID is higher than the length of internal vectors,
    /// the vectors will be extended. A call to set_size is not needed.
    pub fn set_from_tracker(&mut self, tracker: &Self) {
        let incoming_size = tracker.start_set.simple.len();
        if incoming_size > self.start_set.simple.len() {
            self.set_size(incoming_size);
        }

        for index in tracker.metadata.owned_indices() {
            self.tracker_assert_in_bounds(index);
            tracker.tracker_assert_in_bounds(index);
            unsafe {
                let texture_selector = &tracker.metadata.get_resource_unchecked(index).full_range;
                insert_or_barrier_update(
                    texture_selector,
                    Some(&mut self.start_set),
                    &mut self.end_set,
                    &mut self.metadata,
                    index,
                    TextureStateProvider::TextureSet {
                        set: &tracker.start_set,
                    },
                    Some(TextureStateProvider::TextureSet {
                        set: &tracker.end_set,
                    }),
                    ResourceMetadataProvider::Indirect {
                        metadata: &tracker.metadata,
                    },
                    &mut self.temp,
                );
            }
        }
    }

    /// Sets the given state for all textures in the given UsageScope.
    ///
    /// If a transition is needed to get the textures into the needed state,
    /// those transitions are stored within the tracker. A subsequent
    /// call to [`Self::drain_transitions`] is needed to get those transitions.
    ///
    /// If the ID is higher than the length of internal vectors,
    /// the vectors will be extended. A call to set_size is not needed.
    pub fn set_from_usage_scope(&mut self, scope: &TextureUsageScope<A>) {
        let incoming_size = scope.set.simple.len();
        if incoming_size > self.start_set.simple.len() {
            self.set_size(incoming_size);
        }

        for index in scope.metadata.owned_indices() {
            self.tracker_assert_in_bounds(index);
            scope.tracker_assert_in_bounds(index);
            unsafe {
                let texture_selector = &scope.metadata.get_resource_unchecked(index).full_range;
                insert_or_barrier_update(
                    texture_selector,
                    Some(&mut self.start_set),
                    &mut self.end_set,
                    &mut self.metadata,
                    index,
                    TextureStateProvider::TextureSet { set: &scope.set },
                    None,
                    ResourceMetadataProvider::Indirect {
                        metadata: &scope.metadata,
                    },
                    &mut self.temp,
                );
            }
        }
    }

    /// Iterates through all textures in the given bind group and adopts
    /// the state given for those textures in the UsageScope. It also
    /// removes all touched textures from the usage scope.
    ///
    /// If a transition is needed to get the textures into the needed state,
    /// those transitions are stored within the tracker. A subsequent
    /// call to [`Self::drain_transitions`] is needed to get those transitions.
    ///
    /// This is a really funky method used by Compute Passes to generate
    /// barriers after a call to dispatch without needing to iterate
    /// over all elements in the usage scope. We use each the
    /// bind group as a source of which IDs to look at. The bind groups
    /// must have first been added to the usage scope.
    ///
    /// # Safety
    ///
    /// [`Self::set_size`] must be called with the maximum possible Buffer ID before this
    /// method is called.
    pub unsafe fn set_and_remove_from_usage_scope_sparse(
        &mut self,
        scope: &mut TextureUsageScope<A>,
        bind_group_state: &TextureBindGroupState<A>,
    ) {
        let incoming_size = scope.set.simple.len();
        if incoming_size > self.start_set.simple.len() {
            self.set_size(incoming_size);
        }

        let textures = bind_group_state.textures.lock();
        for t in textures.iter() {
            let index = t.texture.as_info().tracker_index().as_usize();
            scope.tracker_assert_in_bounds(index);

            if unsafe { !scope.metadata.contains_unchecked(index) } {
                continue;
            }
            let texture_selector = &t.texture.full_range;
            unsafe {
                insert_or_barrier_update(
                    texture_selector,
                    Some(&mut self.start_set),
                    &mut self.end_set,
                    &mut self.metadata,
                    index,
                    TextureStateProvider::TextureSet { set: &scope.set },
                    None,
                    ResourceMetadataProvider::Indirect {
                        metadata: &scope.metadata,
                    },
                    &mut self.temp,
                )
            };

            unsafe { scope.metadata.remove(index) };
        }
    }

    /// Unconditionally removes the given resource from the tracker.
    ///
    /// Returns true if the resource was removed.
    ///
    /// If the ID is higher than the length of internal vectors,
    /// false will be returned.
    pub fn remove(&mut self, index: TrackerIndex) -> bool {
        let index = index.as_usize();

        if index >= self.metadata.size() {
            return false;
        }

        self.tracker_assert_in_bounds(index);

        unsafe {
            if self.metadata.contains_unchecked(index) {
                self.start_set.complex.remove(&index);
                self.end_set.complex.remove(&index);
                self.metadata.remove(index);
                return true;
            }
        }

        false
    }
}

/// An iterator adapter that can store two different iterator types.
#[derive(Clone)]
enum EitherIter<L, R> {
    Left(L),
    Right(R),
}

impl<L, R, D> Iterator for EitherIter<L, R>
where
    L: Iterator<Item = D>,
    R: Iterator<Item = D>,
{
    type Item = D;

    fn next(&mut self) -> Option<Self::Item> {
        match *self {
            EitherIter::Left(ref mut inner) => inner.next(),
            EitherIter::Right(ref mut inner) => inner.next(),
        }
    }
}

/// Container that signifies storing both different things
/// if there is a single state or many different states
/// involved in the operation.
#[derive(Debug, Clone)]
enum SingleOrManyStates<S, M> {
    Single(S),
    Many(M),
}

/// A source of texture state.
#[derive(Clone)]
enum TextureStateProvider<'a> {
    /// Comes directly from a single state.
    KnownSingle { state: TextureUses },
    /// Comes from a selector and a single state.
    Selector {
        selector: TextureSelector,
        state: TextureUses,
    },
    /// Comes from another texture set.
    TextureSet { set: &'a TextureStateSet },
}
impl<'a> TextureStateProvider<'a> {
    /// Convenience function turning `Option<Selector>` into this enum.
    fn from_option(selector: Option<TextureSelector>, state: TextureUses) -> Self {
        match selector {
            Some(selector) => Self::Selector { selector, state },
            None => Self::KnownSingle { state },
        }
    }

    /// Get the state provided by this.
    ///
    /// # Panics
    ///
    /// Panics if texture_selector is None and this uses a Selector source.
    ///
    /// # Safety
    ///
    /// - The index must be in bounds of the state set if this uses an TextureSet source.
    #[inline(always)]
    unsafe fn get_state(
        self,
        texture_selector: Option<&TextureSelector>,
        index: usize,
    ) -> SingleOrManyStates<
        TextureUses,
        impl Iterator<Item = (TextureSelector, TextureUses)> + Clone + 'a,
    > {
        match self {
            TextureStateProvider::KnownSingle { state } => SingleOrManyStates::Single(state),
            TextureStateProvider::Selector { selector, state } => {
                // We check if the selector given is actually for the full resource,
                // and if it is we promote to a simple state. This allows upstream
                // code to specify selectors willy nilly, and all that are really
                // single states are promoted here.
                if *texture_selector.unwrap() == selector {
                    SingleOrManyStates::Single(state)
                } else {
                    SingleOrManyStates::Many(EitherIter::Left(iter::once((selector, state))))
                }
            }
            TextureStateProvider::TextureSet { set } => {
                let new_state = *unsafe { set.simple.get_unchecked(index) };

                if new_state == TextureUses::COMPLEX {
                    let new_complex = unsafe { set.complex.get(&index).unwrap_unchecked() };

                    SingleOrManyStates::Many(EitherIter::Right(
                        new_complex.to_selector_state_iter(),
                    ))
                } else {
                    SingleOrManyStates::Single(new_state)
                }
            }
        }
    }
}

/// Does an insertion operation if the index isn't tracked
/// in the current metadata, otherwise merges the given state
/// with the current state. If the merging would cause
/// a conflict, returns that usage conflict.
///
/// # Safety
///
/// Indexes must be valid indexes into all arrays passed in
/// to this function, either directly or via metadata or provider structs.
#[inline(always)]
unsafe fn insert_or_merge<A: HalApi>(
    texture_selector: &TextureSelector,
    current_state_set: &mut TextureStateSet,
    resource_metadata: &mut ResourceMetadata<Texture<A>>,
    index: usize,
    state_provider: TextureStateProvider<'_>,
    metadata_provider: ResourceMetadataProvider<'_, Texture<A>>,
) -> Result<(), UsageConflict> {
    let currently_owned = unsafe { resource_metadata.contains_unchecked(index) };

    if !currently_owned {
        unsafe {
            insert(
                Some(texture_selector),
                None,
                current_state_set,
                resource_metadata,
                index,
                state_provider,
                None,
                metadata_provider,
            )
        };
        return Ok(());
    }

    unsafe {
        merge(
            texture_selector,
            current_state_set,
            index,
            state_provider,
            metadata_provider,
        )
    }
}

/// If the resource isn't tracked
/// - Inserts the given resource.
/// - Uses the `start_state_provider` to populate `start_states`
/// - Uses either `end_state_provider` or `start_state_provider`
///   to populate `current_states`.
/// If the resource is tracked
/// - Inserts barriers from the state in `current_states`
///   to the state provided by `start_state_provider`.
/// - Updates the `current_states` with either the state from
///   `end_state_provider` or `start_state_provider`.
///
/// Any barriers are added to the barrier vector.
///
/// # Safety
///
/// Indexes must be valid indexes into all arrays passed in
/// to this function, either directly or via metadata or provider structs.
#[inline(always)]
unsafe fn insert_or_barrier_update<A: HalApi>(
    texture_selector: &TextureSelector,
    start_state: Option<&mut TextureStateSet>,
    current_state_set: &mut TextureStateSet,
    resource_metadata: &mut ResourceMetadata<Texture<A>>,
    index: usize,
    start_state_provider: TextureStateProvider<'_>,
    end_state_provider: Option<TextureStateProvider<'_>>,
    metadata_provider: ResourceMetadataProvider<'_, Texture<A>>,
    barriers: &mut Vec<PendingTransition<TextureUses>>,
) {
    let currently_owned = unsafe { resource_metadata.contains_unchecked(index) };

    if !currently_owned {
        unsafe {
            insert(
                Some(texture_selector),
                start_state,
                current_state_set,
                resource_metadata,
                index,
                start_state_provider,
                end_state_provider,
                metadata_provider,
            )
        };
        return;
    }

    let update_state_provider = end_state_provider.unwrap_or_else(|| start_state_provider.clone());
    unsafe {
        barrier(
            texture_selector,
            current_state_set,
            index,
            start_state_provider,
            barriers,
        )
    };

    let start_state_set = start_state.unwrap();
    unsafe {
        update(
            texture_selector,
            start_state_set,
            current_state_set,
            index,
            update_state_provider,
        )
    };
}

#[inline(always)]
unsafe fn insert<A: HalApi>(
    texture_selector: Option<&TextureSelector>,
    start_state: Option<&mut TextureStateSet>,
    end_state: &mut TextureStateSet,
    resource_metadata: &mut ResourceMetadata<Texture<A>>,
    index: usize,
    start_state_provider: TextureStateProvider<'_>,
    end_state_provider: Option<TextureStateProvider<'_>>,
    metadata_provider: ResourceMetadataProvider<'_, Texture<A>>,
) {
    let start_layers = unsafe { start_state_provider.get_state(texture_selector, index) };
    match start_layers {
        SingleOrManyStates::Single(state) => {
            // This should only ever happen with a wgpu bug, but let's just double
            // check that resource states don't have any conflicts.
            strict_assert_eq!(invalid_resource_state(state), false);

            log::trace!("\ttex {index}: insert start {state:?}");

            if let Some(start_state) = start_state {
                unsafe { *start_state.simple.get_unchecked_mut(index) = state };
            }

            // We only need to insert ourselves the end state if there is no end state provider.
            if end_state_provider.is_none() {
                unsafe { *end_state.simple.get_unchecked_mut(index) = state };
            }
        }
        SingleOrManyStates::Many(state_iter) => {
            let full_range = texture_selector.unwrap().clone();

            let complex =
                unsafe { ComplexTextureState::from_selector_state_iter(full_range, state_iter) };

            log::trace!("\ttex {index}: insert start {complex:?}");

            if let Some(start_state) = start_state {
                unsafe { *start_state.simple.get_unchecked_mut(index) = TextureUses::COMPLEX };
                start_state.complex.insert(index, complex.clone());
            }

            // We only need to insert ourselves the end state if there is no end state provider.
            if end_state_provider.is_none() {
                unsafe { *end_state.simple.get_unchecked_mut(index) = TextureUses::COMPLEX };
                end_state.complex.insert(index, complex);
            }
        }
    }

    if let Some(end_state_provider) = end_state_provider {
        match unsafe { end_state_provider.get_state(texture_selector, index) } {
            SingleOrManyStates::Single(state) => {
                // This should only ever happen with a wgpu bug, but let's just double
                // check that resource states don't have any conflicts.
                strict_assert_eq!(invalid_resource_state(state), false);

                log::trace!("\ttex {index}: insert end {state:?}");

                // We only need to insert into the end, as there is guaranteed to be
                // a start state provider.
                unsafe { *end_state.simple.get_unchecked_mut(index) = state };
            }
            SingleOrManyStates::Many(state_iter) => {
                let full_range = texture_selector.unwrap().clone();

                let complex = unsafe {
                    ComplexTextureState::from_selector_state_iter(full_range, state_iter)
                };

                log::trace!("\ttex {index}: insert end {complex:?}");

                // We only need to insert into the end, as there is guaranteed to be
                // a start state provider.
                unsafe { *end_state.simple.get_unchecked_mut(index) = TextureUses::COMPLEX };
                end_state.complex.insert(index, complex);
            }
        }
    }

    unsafe {
        let resource = metadata_provider.get_own(index);
        resource_metadata.insert(index, resource);
    }
}

#[inline(always)]
unsafe fn merge<A: HalApi>(
    texture_selector: &TextureSelector,
    current_state_set: &mut TextureStateSet,
    index: usize,
    state_provider: TextureStateProvider<'_>,
    metadata_provider: ResourceMetadataProvider<'_, Texture<A>>,
) -> Result<(), UsageConflict> {
    let current_simple = unsafe { current_state_set.simple.get_unchecked_mut(index) };
    let current_state = if *current_simple == TextureUses::COMPLEX {
        SingleOrManyStates::Many(unsafe {
            current_state_set.complex.get_mut(&index).unwrap_unchecked()
        })
    } else {
        SingleOrManyStates::Single(current_simple)
    };

    let new_state = unsafe { state_provider.get_state(Some(texture_selector), index) };

    match (current_state, new_state) {
        (SingleOrManyStates::Single(current_simple), SingleOrManyStates::Single(new_simple)) => {
            let merged_state = *current_simple | new_simple;

            log::trace!("\ttex {index}: merge simple {current_simple:?} + {new_simple:?}");

            if invalid_resource_state(merged_state) {
                return Err(UsageConflict::from_texture(
                    unsafe { metadata_provider.get_own(index).info.id() },
                    texture_selector.clone(),
                    *current_simple,
                    new_simple,
                ));
            }

            *current_simple = merged_state;
        }
        (SingleOrManyStates::Single(current_simple), SingleOrManyStates::Many(new_many)) => {
            // Because we are now demoting this simple state to a complex state,
            // we actually need to make a whole new complex state for us to use
            // as there wasn't one before.
            let mut new_complex = unsafe {
                ComplexTextureState::from_selector_state_iter(
                    texture_selector.clone(),
                    iter::once((texture_selector.clone(), *current_simple)),
                )
            };

            for (selector, new_state) in new_many {
                let merged_state = *current_simple | new_state;

                log::trace!("\ttex {index}: merge {selector:?} {current_simple:?} + {new_state:?}");

                if invalid_resource_state(merged_state) {
                    return Err(UsageConflict::from_texture(
                        unsafe { metadata_provider.get_own(index).info.id() },
                        selector,
                        *current_simple,
                        new_state,
                    ));
                }

                for mip in
                    &mut new_complex.mips[selector.mips.start as usize..selector.mips.end as usize]
                {
                    for &mut (_, ref mut current_layer_state) in
                        mip.isolate(&selector.layers, TextureUses::UNKNOWN)
                    {
                        *current_layer_state = merged_state;
                    }

                    mip.coalesce();
                }
            }

            *current_simple = TextureUses::COMPLEX;
            current_state_set.complex.insert(index, new_complex);
        }
        (SingleOrManyStates::Many(current_complex), SingleOrManyStates::Single(new_simple)) => {
            for (mip_id, mip) in current_complex.mips.iter_mut().enumerate() {
                let mip_id = mip_id as u32;

                for &mut (ref layers, ref mut current_layer_state) in mip.iter_mut() {
                    let merged_state = *current_layer_state | new_simple;

                    // Once we remove unknown, this will never be empty, as
                    // simple states are never unknown.
                    let merged_state = merged_state - TextureUses::UNKNOWN;

                    log::trace!(
                        "\ttex {index}: merge mip {mip_id} layers {layers:?} \
                         {current_layer_state:?} + {new_simple:?}"
                    );

                    if invalid_resource_state(merged_state) {
                        return Err(UsageConflict::from_texture(
                            unsafe { metadata_provider.get_own(index).info.id() },
                            TextureSelector {
                                mips: mip_id..mip_id + 1,
                                layers: layers.clone(),
                            },
                            *current_layer_state,
                            new_simple,
                        ));
                    }

                    *current_layer_state = merged_state;
                }

                mip.coalesce();
            }
        }
        (SingleOrManyStates::Many(current_complex), SingleOrManyStates::Many(new_many)) => {
            for (selector, new_state) in new_many {
                for mip_id in selector.mips {
                    strict_assert!((mip_id as usize) < current_complex.mips.len());

                    let mip = unsafe { current_complex.mips.get_unchecked_mut(mip_id as usize) };

                    for &mut (ref layers, ref mut current_layer_state) in
                        mip.isolate(&selector.layers, TextureUses::UNKNOWN)
                    {
                        let merged_state = *current_layer_state | new_state;
                        let merged_state = merged_state - TextureUses::UNKNOWN;

                        if merged_state.is_empty() {
                            // We know nothing about this state, lets just move on.
                            continue;
                        }

                        log::trace!(
                            "\ttex {index}: merge mip {mip_id} layers {layers:?} \
                             {current_layer_state:?} + {new_state:?}"
                        );

                        if invalid_resource_state(merged_state) {
                            return Err(UsageConflict::from_texture(
                                unsafe { metadata_provider.get_own(index).info.id() },
                                TextureSelector {
                                    mips: mip_id..mip_id + 1,
                                    layers: layers.clone(),
                                },
                                *current_layer_state,
                                new_state,
                            ));
                        }
                        *current_layer_state = merged_state;
                    }

                    mip.coalesce();
                }
            }
        }
    }
    Ok(())
}

#[inline(always)]
unsafe fn barrier(
    texture_selector: &TextureSelector,
    current_state_set: &TextureStateSet,
    index: usize,
    state_provider: TextureStateProvider<'_>,
    barriers: &mut Vec<PendingTransition<TextureUses>>,
) {
    let current_simple = unsafe { *current_state_set.simple.get_unchecked(index) };
    let current_state = if current_simple == TextureUses::COMPLEX {
        SingleOrManyStates::Many(unsafe {
            current_state_set.complex.get(&index).unwrap_unchecked()
        })
    } else {
        SingleOrManyStates::Single(current_simple)
    };

    let new_state = unsafe { state_provider.get_state(Some(texture_selector), index) };

    match (current_state, new_state) {
        (SingleOrManyStates::Single(current_simple), SingleOrManyStates::Single(new_simple)) => {
            if skip_barrier(current_simple, new_simple) {
                return;
            }

            log::trace!("\ttex {index}: transition simple {current_simple:?} -> {new_simple:?}");

            barriers.push(PendingTransition {
                id: index as _,
                selector: texture_selector.clone(),
                usage: current_simple..new_simple,
            });
        }
        (SingleOrManyStates::Single(current_simple), SingleOrManyStates::Many(new_many)) => {
            for (selector, new_state) in new_many {
                if new_state == TextureUses::UNKNOWN {
                    continue;
                }

                if skip_barrier(current_simple, new_state) {
                    continue;
                }

                log::trace!(
                    "\ttex {index}: transition {selector:?} {current_simple:?} -> {new_state:?}"
                );

                barriers.push(PendingTransition {
                    id: index as _,
                    selector,
                    usage: current_simple..new_state,
                });
            }
        }
        (SingleOrManyStates::Many(current_complex), SingleOrManyStates::Single(new_simple)) => {
            for (mip_id, mip) in current_complex.mips.iter().enumerate() {
                let mip_id = mip_id as u32;

                for &(ref layers, current_layer_state) in mip.iter() {
                    if current_layer_state == TextureUses::UNKNOWN {
                        continue;
                    }

                    if skip_barrier(current_layer_state, new_simple) {
                        continue;
                    }

                    log::trace!(
                        "\ttex {index}: transition mip {mip_id} layers {layers:?} \
                         {current_layer_state:?} -> {new_simple:?}"
                    );

                    barriers.push(PendingTransition {
                        id: index as _,
                        selector: TextureSelector {
                            mips: mip_id..mip_id + 1,
                            layers: layers.clone(),
                        },
                        usage: current_layer_state..new_simple,
                    });
                }
            }
        }
        (SingleOrManyStates::Many(current_complex), SingleOrManyStates::Many(new_many)) => {
            for (selector, new_state) in new_many {
                for mip_id in selector.mips {
                    strict_assert!((mip_id as usize) < current_complex.mips.len());

                    let mip = unsafe { current_complex.mips.get_unchecked(mip_id as usize) };

                    for (layers, current_layer_state) in mip.iter_filter(&selector.layers) {
                        if *current_layer_state == TextureUses::UNKNOWN
                            || new_state == TextureUses::UNKNOWN
                        {
                            continue;
                        }

                        if skip_barrier(*current_layer_state, new_state) {
                            continue;
                        }

                        log::trace!(
                            "\ttex {index}: transition mip {mip_id} layers {layers:?} \
                            {current_layer_state:?} -> {new_state:?}"
                        );

                        barriers.push(PendingTransition {
                            id: index as _,
                            selector: TextureSelector {
                                mips: mip_id..mip_id + 1,
                                layers,
                            },
                            usage: *current_layer_state..new_state,
                        });
                    }
                }
            }
        }
    }
}

#[allow(clippy::needless_option_as_deref)] // we use this for reborrowing Option<&mut T>
#[inline(always)]
unsafe fn update(
    texture_selector: &TextureSelector,
    start_state_set: &mut TextureStateSet,
    current_state_set: &mut TextureStateSet,
    index: usize,
    state_provider: TextureStateProvider<'_>,
) {
    let start_simple = unsafe { *start_state_set.simple.get_unchecked(index) };

    // We only ever need to update the start state here if the state is complex.
    //
    // If the state is simple, the first insert to the tracker would cover it.
    let mut start_complex = None;
    if start_simple == TextureUses::COMPLEX {
        start_complex = Some(unsafe { start_state_set.complex.get_mut(&index).unwrap_unchecked() });
    }

    let current_simple = unsafe { current_state_set.simple.get_unchecked_mut(index) };
    let current_state = if *current_simple == TextureUses::COMPLEX {
        SingleOrManyStates::Many(unsafe {
            current_state_set.complex.get_mut(&index).unwrap_unchecked()
        })
    } else {
        SingleOrManyStates::Single(current_simple)
    };

    let new_state = unsafe { state_provider.get_state(Some(texture_selector), index) };

    match (current_state, new_state) {
        (SingleOrManyStates::Single(current_simple), SingleOrManyStates::Single(new_simple)) => {
            *current_simple = new_simple;
        }
        (SingleOrManyStates::Single(current_simple), SingleOrManyStates::Many(new_many)) => {
            // Because we are now demoting this simple state to a complex state,
            // we actually need to make a whole new complex state for us to use
            // as there wasn't one before.
            let mut new_complex = unsafe {
                ComplexTextureState::from_selector_state_iter(
                    texture_selector.clone(),
                    iter::once((texture_selector.clone(), *current_simple)),
                )
            };

            for (selector, mut new_state) in new_many {
                if new_state == TextureUses::UNKNOWN {
                    new_state = *current_simple;
                }
                for mip in
                    &mut new_complex.mips[selector.mips.start as usize..selector.mips.end as usize]
                {
                    for &mut (_, ref mut current_layer_state) in
                        mip.isolate(&selector.layers, TextureUses::UNKNOWN)
                    {
                        *current_layer_state = new_state;
                    }

                    mip.coalesce();
                }
            }

            *current_simple = TextureUses::COMPLEX;
            current_state_set.complex.insert(index, new_complex);
        }
        (SingleOrManyStates::Many(current_complex), SingleOrManyStates::Single(new_single)) => {
            for (mip_id, mip) in current_complex.mips.iter().enumerate() {
                for &(ref layers, current_layer_state) in mip.iter() {
                    // If this state is unknown, that means that the start is _also_ unknown.
                    if current_layer_state == TextureUses::UNKNOWN {
                        if let Some(&mut ref mut start_complex) = start_complex {
                            strict_assert!(mip_id < start_complex.mips.len());

                            let start_mip = unsafe { start_complex.mips.get_unchecked_mut(mip_id) };

                            for &mut (_, ref mut current_start_state) in
                                start_mip.isolate(layers, TextureUses::UNKNOWN)
                            {
                                strict_assert_eq!(*current_start_state, TextureUses::UNKNOWN);
                                *current_start_state = new_single;
                            }

                            start_mip.coalesce();
                        }
                    }
                }
            }

            unsafe { *current_state_set.simple.get_unchecked_mut(index) = new_single };
            unsafe { current_state_set.complex.remove(&index).unwrap_unchecked() };
        }
        (SingleOrManyStates::Many(current_complex), SingleOrManyStates::Many(new_many)) => {
            for (selector, new_state) in new_many {
                if new_state == TextureUses::UNKNOWN {
                    // We know nothing new
                    continue;
                }

                for mip_id in selector.mips {
                    let mip_id = mip_id as usize;
                    strict_assert!(mip_id < current_complex.mips.len());

                    let mip = unsafe { current_complex.mips.get_unchecked_mut(mip_id) };

                    for &mut (ref layers, ref mut current_layer_state) in
                        mip.isolate(&selector.layers, TextureUses::UNKNOWN)
                    {
                        if *current_layer_state == TextureUses::UNKNOWN
                            && new_state != TextureUses::UNKNOWN
                        {
                            // We now know something about this subresource that
                            // we didn't before so we should go back and update
                            // the start state.
                            //
                            // We know we must have starter state be complex,
                            // otherwise we would know about this state.
                            strict_assert!(start_complex.is_some());

                            let start_complex =
                                unsafe { start_complex.as_deref_mut().unwrap_unchecked() };

                            strict_assert!(mip_id < start_complex.mips.len());

                            let start_mip = unsafe { start_complex.mips.get_unchecked_mut(mip_id) };

                            for &mut (_, ref mut current_start_state) in
                                start_mip.isolate(layers, TextureUses::UNKNOWN)
                            {
                                strict_assert_eq!(*current_start_state, TextureUses::UNKNOWN);
                                *current_start_state = new_state;
                            }

                            start_mip.coalesce();
                        }

                        *current_layer_state = new_state;
                    }

                    mip.coalesce();
                }
            }
        }
    }
}
