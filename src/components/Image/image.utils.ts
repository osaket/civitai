import { MetricTimeframe, ReviewReactions, ImageIngestionStatus } from '@prisma/client';
import { useMemo } from 'react';
import { z } from 'zod';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useZodRouteParams } from '~/hooks/useZodRouteParams';
import { useFiltersContext, FilterKeys } from '~/providers/FiltersProvider';
import { useHiddenPreferencesContext } from '~/providers/HiddenPreferencesProvider';
import { ImageSort } from '~/server/common/enums';
import { periodModeSchema } from '~/server/schema/base.schema';
import { GetImagesByCategoryInput, GetInfiniteImagesInput } from '~/server/schema/image.schema';
import { removeEmpty } from '~/utils/object-helpers';
import { postgresSlugify } from '~/utils/string-helpers';
import { trpc } from '~/utils/trpc';
import { numericString, numericStringArray } from '~/utils/zod-helpers';

export const imagesQueryParamSchema = z
  .object({
    modelId: numericString(),
    modelVersionId: numericString(),
    postId: numericString(),
    collectionId: numericString(),
    username: z.coerce.string().transform(postgresSlugify),
    prioritizedUserIds: numericStringArray(),
    limit: numericString(),
    period: z.nativeEnum(MetricTimeframe),
    periodMode: periodModeSchema,
    sort: z.nativeEnum(ImageSort),
    tags: numericStringArray(),
    view: z.enum(['categories', 'feed']),
    excludeCrossPosts: z.boolean(),
    reactions: z.preprocess(
      (val) => (Array.isArray(val) ? val : [val]),
      z.array(z.nativeEnum(ReviewReactions))
    ),
    section: z.enum(['images', 'reactions']),
  })
  .partial();

export const useImageQueryParams = () => useZodRouteParams(imagesQueryParamSchema);

export const useImageFilters = (type: FilterKeys<'images' | 'modelImages'>) => {
  const storeFilters = useFiltersContext((state) => state[type]);
  const { query } = useImageQueryParams(); // router params are the overrides
  return removeEmpty({ ...storeFilters, ...query });
};

export const useQueryImages = (
  filters?: Partial<GetInfiniteImagesInput>,
  options?: { keepPreviousData?: boolean; enabled?: boolean }
) => {
  filters ??= {};
  const { data, ...rest } = trpc.image.getInfinite.useInfiniteQuery(
    { ...filters },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      trpc: { context: { skipBatch: true } },
      ...options,
    }
  );

  const currentUser = useCurrentUser();
  const {
    images: hiddenImages,
    tags: hiddenTags,
    users: hiddenUsers,
    isLoading: isLoadingHidden,
  } = useHiddenPreferencesContext();

  const images = useMemo(() => {
    // TODO - fetch user reactions for images separately
    if (isLoadingHidden) return [];
    const arr = data?.pages.flatMap((x) => x.items) ?? [];
    const filtered = arr.filter((x) => {
      if (x.user.id === currentUser?.id) return true;
      if (x.ingestion !== ImageIngestionStatus.Scanned) return false;
      if (hiddenImages.get(x.id)) return false;
      if (hiddenUsers.get(x.user.id)) return false;
      for (const tag of x.tagIds ?? []) if (hiddenTags.get(tag)) return false;
      return true;
    });
    return filtered;
  }, [data, currentUser, hiddenImages, hiddenTags, hiddenUsers, isLoadingHidden]);

  return { data, images, ...rest };
};

export const useQueryImageCategories = (
  filters?: Partial<GetImagesByCategoryInput>,
  options?: { keepPreviousData?: boolean; enabled?: boolean }
) => {
  filters ??= {};
  const browsingMode = useFiltersContext((state) => state.browsingMode);
  const { data, ...rest } = trpc.image.getImagesByCategory.useInfiniteQuery(
    { ...filters, browsingMode },
    {
      getNextPageParam: (lastPage) => (!!lastPage ? lastPage.nextCursor : 0),
      getPreviousPageParam: (firstPage) => (!!firstPage ? firstPage.nextCursor : 0),
      trpc: { context: { skipBatch: true } },
      keepPreviousData: true,
      ...options,
    }
  );

  const categories = useMemo(() => data?.pages.flatMap((x) => x.items) ?? [], [data]);

  return { data, categories, ...rest };
};
